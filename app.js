/**
 * Alpine.js demo application for Session Spawn.
 * Standalone — no SSE, no API, no fetch(). Scenarios loaded via <script> tags.
 */

function demoApp() {
  return {
    // Scenario selection
    scenarios: DEMO_SCENARIOS,
    selectedScenario: null,
    _scenarioKey: '',  // x-model for <select>

    // Replay state
    orchestratorStatus: 'idle',
    prompt: '',
    runs: [],
    finalResult: null,
    parentSessionId: null,
    orchestratorTimer: '',
    orchestratorStartTime: null,

    // Chat view (same as dashboard)
    chatMessages: [],
    _allChatMsgs: [],
    _revealedCount: 0,
    _revealTimer: null,
    chatTyping: false,
    chatTypingInfo: null,
    chatExpandedIds: new Set(),
    _chatExpandTick: 0,

    // Backstage (independent from chat reveal system)
    backstageStage: 'hidden',
    _backstageTimer: null,

    // Timer
    _timerInterval: null,
    // Replay timers (for cleanup)
    _replayTimers: [],

    init() {
      // No fetch needed — scenarios are loaded via <script> tags
      this._timerInterval = setInterval(() => this.updateTimers(), 1000);
    },

    playScenario(key) {
      const scenario = window[key];
      if (!scenario) return;
      this.selectedScenario = key;
      this._startReplay(scenario);
    },

    _startReplay(scenario) {
      // Clean up previous replay
      this._clearReplayTimers();
      if (this._revealTimer) { clearTimeout(this._revealTimer); this._revealTimer = null; }

      // Reset state
      this.prompt = scenario.prompt;
      this.orchestratorStatus = 'running';
      this.finalResult = null;
      this.runs = [];
      this.parentSessionId = 'demo-parent';
      this.orchestratorStartTime = Date.now() / 1000;
      this.chatExpandedIds = new Set();
      this._chatExpandTick = 0;
      this.backstageStage = 'hidden';
      if (this._backstageTimer) { clearTimeout(this._backstageTimer); this._backstageTimer = null; }

      // Phase 0: Boss intro (instant)
      this.chatMessages = [
        { id: 0, sender: 'parent', senderLabel: 'AI-エージェント',
          content: `【${this.prompt}】をタスクに分解します！`,
          side: 'left', avatar: 'Main', colorIdx: -1, _phase: 0 },
      ];
      this._allChatMsgs = [];
      this._revealedCount = 1;
      this.chatTyping = false;
      this.chatTypingInfo = null;

      // Stage runs injection (created_at order)
      const sortedRuns = [...scenario.runs].sort((a, b) => a.created_at - b.created_at);
      this._replayRuns(sortedRuns, 0, scenario);
    },

    _replayRuns(sortedRuns, index, scenario) {
      if (index >= sortedRuns.length) {
        this._waitForCompletion(sortedRuns, scenario);
        return;
      }

      const delay = index === 0 ? 500
        : Math.min(Math.max(
            (sortedRuns[index].created_at - sortedRuns[index - 1].created_at) * 1000,
            200), 2000);

      const tid = setTimeout(() => {
        const run = sortedRuns[index];
        // Add run as "paused" initially (no started_at/ended_at yet)
        this.runs.push({
          ...run,
          started_at: null,
          ended_at: null,
          status: 'paused',
          outcome_text: null,
          elapsed: '',
        });
        this.runs.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
        this._buildChatFromRuns();
        this._replayRuns(sortedRuns, index + 1, scenario);
      }, delay);
      this._replayTimers.push(tid);
    },

    _waitForCompletion(sortedRuns, scenario) {
      // Build timeline events from started_at / ended_at
      const events = [];
      for (const run of sortedRuns) {
        if (run.started_at) events.push({ ts: run.started_at, type: 'start', run });
        if (run.ended_at) events.push({ ts: run.ended_at, type: 'end', run });
      }
      events.sort((a, b) => a.ts - b.ts);

      let idx = 0;
      const playNext = () => {
        if (idx >= events.length) {
          // All done → Phase 4 with short delay
          const tid = setTimeout(() => {
            this.orchestratorStatus = 'done';
            this.finalResult = scenario.finalResult;
            this._buildChatFromRuns();
          }, 800);
          this._replayTimers.push(tid);
          return;
        }
        const ev = events[idx];
        const delay = idx === 0 ? 500
          : Math.min(Math.max((events[idx].ts - events[idx - 1].ts) * 1000, 300), 2000);
        idx++;

        const tid = setTimeout(() => {
          const ri = this.runs.findIndex(r => r.run_id === ev.run.run_id);
          if (ri >= 0) {
            if (ev.type === 'start') {
              this.runs[ri] = {
                ...this.runs[ri],
                started_at: ev.run.started_at,
                status: 'running',
              };
            } else {
              this.runs[ri] = {
                ...this.runs[ri],
                ended_at: ev.run.ended_at,
                status: ev.run.status,
                outcome_text: ev.run.outcome_text,
                elapsed: calcElapsed(ev.run),
              };
            }
          }
          this._buildChatFromRuns();
          playNext();
        }, delay);
        this._replayTimers.push(tid);
      };
      playNext();
    },

    _clearReplayTimers() {
      for (const tid of this._replayTimers) clearTimeout(tid);
      this._replayTimers = [];
    },

    updateTimers() {
      if (this.orchestratorStatus === 'running' && this.orchestratorStartTime) {
        this.orchestratorTimer = formatElapsed(Date.now() / 1000 - this.orchestratorStartTime);
      } else {
        this.orchestratorTimer = '';
      }
      for (let i = 0; i < this.runs.length; i++) {
        if (this.runs[i].status === 'running' || this.runs[i].status === 'paused') {
          this.runs[i].elapsed = calcElapsed(this.runs[i]);
        }
      }
    },

    // === Chat methods (copied from web/static/js/app.js) ===

    _buildChatFromRuns() {
      const msgs = [];
      let id = 0;
      const childMap = {};
      let childIdx = 0;

      const getChild = (sid) => {
        if (!childMap[sid]) {
          const idx = childIdx++;
          const letter = assignChildLetter(idx);
          childMap[sid] = { letter, label: `AIサブエージェント${letter}`, colorIdx: idx };
        }
        return childMap[sid];
      };

      const add = (sender, senderLabel, content, side, avatar, colorIdx, phase, fullContent) => {
        msgs.push({ id: id++, sender, senderLabel, content, side, avatar, colorIdx, _phase: phase,
                    fullContent: fullContent || null });
      };

      // Phase 0: Boss intro
      if (this.prompt.trim() && this.orchestratorStatus !== 'idle') {
        add('parent', 'AI-エージェント', `【${this.prompt}】をタスクに分解します！`, 'left', 'Main', -1, 0);
      }

      const sorted = [...this.runs].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

      // Phase 1: Boss assigns tasks
      for (const run of sorted) {
        const info = getChild(run.child_session_id);
        add('parent', 'AI-エージェント',
          `${info.label}、【${run.task}】をやるように。できたら報告せよ。`, 'left', 'Main', -1, 1);
      }

      // Phase 2: Children acknowledge (started_at order)
      const started = sorted.filter(r => r.started_at).sort((a, b) => a.started_at - b.started_at);
      for (const run of started) {
        const info = getChild(run.child_session_id);
        add(run.child_session_id, info.label,
          `はい、わかりました。【${run.task}】に取り掛かります！`, 'right', info.letter, info.colorIdx, 2);
      }

      // Phase 3: Children report results (ended_at order)
      const ended = sorted.filter(r => r.ended_at).sort((a, b) => a.ended_at - b.ended_at);
      for (const run of ended) {
        const info = getChild(run.child_session_id);
        switch (run.status) {
          case 'completed': {
            const summary = truncateText(run.outcome_text, 200);
            const isTruncated = summary && summary !== (run.outcome_text || '');
            const displayText = summary
              ? `【${run.task}】が完了しました！報告します。\n${summary}`
              : `【${run.task}】が完了しました！`;
            const fullText = isTruncated
              ? `【${run.task}】が完了しました！報告します。\n${run.outcome_text}`
              : null;
            add(run.child_session_id, info.label, displayText, 'right',
                info.letter, info.colorIdx, 3, fullText);
            break;
          }
          case 'error':
            add(run.child_session_id, info.label,
              `すみません、【${run.task}】でエラーが発生しました…`, 'right', info.letter, info.colorIdx, 3);
            break;
          case 'timeout':
            add(run.child_session_id, info.label,
              `【${run.task}】に時間がかかりすぎてしまいました…`, 'right', info.letter, info.colorIdx, 3);
            break;
        }
      }

      // Phase 4: Boss summary — full text, no truncation
      if (this.orchestratorStatus === 'done' && this.finalResult) {
        add('parent', 'AI-エージェント',
          `全タスクの結果をまとめました。\n\n${this.finalResult}`,
          'left', 'Main', -1, 4);
      }

      this._allChatMsgs = msgs;
      this._scheduleReveal();
    },

    _getRevealDelay(msg) {
      if (msg._phase >= 4) return 0;
      if (msg._phase === 3) {
        const base = 700;
        const typingTime = Math.min(msg.content.length * 8, 1200);
        const jitter = (Math.random() - 0.5) * 600;
        return Math.max(500, Math.round(base + typingTime + jitter));
      }
      const base = 500;
      const typingTime = Math.min(msg.content.length * 10, 800);
      const jitter = (Math.random() - 0.5) * 400;
      return Math.max(300, Math.round(base + typingTime + jitter));
    },

    _scheduleReveal() {
      const all = this._allChatMsgs;
      if (this._revealedCount > all.length) this._revealedCount = all.length;

      if (this._revealedCount >= all.length) {
        this.chatTyping = false;
        this.chatTypingInfo = null;
        if (this.orchestratorStatus === 'done' && this.finalResult && this.backstageStage === 'hidden') {
          this._startBackstage();
        }
        return;
      }

      const next = all[this._revealedCount];
      const delay = this._getRevealDelay(next);

      if (delay === 0) {
        this.chatTyping = false;
        this.chatTypingInfo = null;
        this._revealedCount++;
        this.chatMessages = all.slice(0, this._revealedCount);
        this._scrollChat();
        this._scheduleReveal();
        return;
      }

      this.chatTyping = true;
      this.chatTypingInfo = {
        avatar: next.avatar, colorIdx: next.colorIdx,
        side: next.side, senderLabel: next.senderLabel,
      };
      this._scrollChat();

      if (this._revealTimer) return;

      this._revealTimer = setTimeout(() => {
        this._revealTimer = null;
        this._revealedCount++;
        this.chatMessages = this._allChatMsgs.slice(0, this._revealedCount);
        this._scrollChat();
        this._scheduleReveal();
      }, delay);
    },

    _scrollChat() {
      this.$nextTick(() => {
        const el = this.$refs.chatPane;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },

    toggleChatExpand(msgId) {
      if (this.chatExpandedIds.has(msgId)) {
        this.chatExpandedIds.delete(msgId);
      } else {
        this.chatExpandedIds.add(msgId);
      }
      this._chatExpandTick++;
    },

    isChatExpanded(msgId) {
      this._chatExpandTick;
      return this.chatExpandedIds.has(msgId);
    },

    _startBackstage() {
      if (this._backstageTimer) clearTimeout(this._backstageTimer);
      this._backstageTimer = setTimeout(() => {
        this.backstageStage = 'header';
        this._scrollChat();
        this._backstageTimer = setTimeout(() => {
          this.backstageStage = 'full';
          this._scrollChat();
          this._backstageTimer = null;
        }, 5000);
      }, 20000);
    },

    destroy() {
      if (this._timerInterval) clearInterval(this._timerInterval);
      if (this._revealTimer) clearTimeout(this._revealTimer);
      if (this._backstageTimer) clearTimeout(this._backstageTimer);
      this._clearReplayTimers();
    },
  };
}
