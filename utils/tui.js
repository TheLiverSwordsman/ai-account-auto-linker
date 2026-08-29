const prompts = require('prompts');

class TUI {
  constructor() {
    try {
      const chalkModule = require('chalk');
      // chalk v5+ is ESM-only, so require returns { default: chalk }
      const chalk = chalkModule.default || chalkModule;
      this.colors = {
        primary: chalk.cyan,
        success: chalk.green,
        error: chalk.red,
        warning: chalk.yellow,
        muted: chalk.gray,
        highlight: chalk.white
      };
    } catch (e) {
      // Fallback if chalk not available
      this.colors = {
        primary: text => text,
        success: text => text,
        error: text => text,
        warning: text => text,
        muted: text => text,
        highlight: text => text
      };
    }
  }

  box(title, options = {}) {
    const width = options.width || 60;
    const padding = options.padding ?? 2;
    const lines = Array.isArray(title) ? title : [title];
    const innerWidth = width - 2;
    const contentWidth = innerWidth - padding * 2;
    const top = `╔${'═'.repeat(innerWidth)}╗`;
    const bottom = `╚${'═'.repeat(innerWidth)}╝`;
    const body = lines.map(line => {
      const text = String(line);
      const clipped = text.length > contentWidth ? text.slice(0, contentWidth) : text;
      const align = options.align || 'left';
      const remaining = contentWidth - clipped.length;
      const leftPad = align === 'center' ? Math.floor(remaining / 2) : 0;
      const rightPad = remaining - leftPad;
      return `║${' '.repeat(padding + leftPad)}${clipped}${' '.repeat(padding + rightPad)}║`;
    });

    return [top, ...body, bottom].join('\n');
  }

  printBox(title, options = {}) {
    const box = this.box(title, options);
    console.log((options.color || this.colors.primary)(box));
  }

  header() {
    console.log('');
    this.printBox('Account Auto Linker v1.0.0', { width: 62 });
    console.log('');
  }

  async mainMenu() {
    const choices = [
      { title: 'Login with existing Kiro account', value: 'login', description: 'Sign into an existing AWS/Kiro account' },
      { title: 'Full registration', value: 'register', description: 'Create new AWS account + dashboard connection' },
      { title: 'Settings', value: 'settings', description: 'Configure email providers and permissions' },
      { title: 'Exit', value: 'exit', description: 'Exit the application' }
    ];

    const response = await prompts({
      type: 'select',
      name: 'action',
      message: 'What would you like to do?',
      choices,
      initial: 0
    }, {
      onCancel: () => process.exit(130)
    });

    return response.action;
  }

  async settingsTabs(context = {}) {
    if (!process.stdin.isTTY) {
      const response = await prompts({
        type: 'select',
        name: 'tab',
        message: 'Settings',
        choices: [
          { title: 'Inboxes', value: 'inboxes', description: 'Select which Mailstack inboxes can be used' },
          { title: 'Utilities', value: 'utilities', description: 'Workers and browser mode' },
          { title: '← Back to main menu', value: 'back' }
        ],
        initial: 0
      }, {
        onCancel: () => process.exit(130)
      });

      return response.tab;
    }

    return new Promise((resolve) => {
      const readline = require('readline');
      const tabs = [
        { label: 'Inboxes', value: 'inboxes', hint: 'Space toggles selected inbox, R refreshes from Mailstack' },
        { label: 'Utilities', value: 'utilities', hint: 'Space cycles selected option' }
      ];
      const state = {
        activeIndex: 0,
        inboxCursor: 0,
        utilityCursor: 0,
        inboxes: context.inboxes || [],
        utilities: context.utilities || { workers: 1, headless: false },
        message: '',
        busy: false
      };
      let closed = false;

      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        process.stdin.off('keypress', onKeypress);
        if (process.stdin.isRaw) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
      };

      const saveUtilities = (patch) => {
        state.utilities = {
          ...state.utilities,
          ...patch
        };
        if (context.saveUtilities) {
          state.utilities = context.saveUtilities(state.utilities) || state.utilities;
        }
      };

      const refreshFromContext = () => {
        if (context.getInboxes) state.inboxes = context.getInboxes() || state.inboxes;
        if (context.getUtilities) state.utilities = context.getUtilities() || state.utilities;
      };

      const renderTabs = () => {
        const tabBar = tabs.map((tab, index) => {
          const label = ` ${tab.label} `;
          return index === state.activeIndex
            ? this.colors.primary(`╭${'─'.repeat(label.length)}╮`) + '\n' +
              this.colors.primary('│') + this.colors.highlight(label) + this.colors.primary('│') + '\n' +
              this.colors.primary(`╰${'─'.repeat(label.length)}╯`)
            : this.colors.muted(`  ${label}  \n  ${' '.repeat(label.length)}  \n  ${' '.repeat(label.length)}  `);
        });

        const tabLines = tabBar.map(block => block.split('\n'));
        for (let line = 0; line < 3; line++) {
          console.log(tabLines.map(lines => lines[line]).join('  '));
        }
      };

      const renderInboxes = () => {
        const inboxes = state.inboxes;
        const allowed = inboxes.filter(inbox => inbox.allowed);
        const blocked = inboxes.filter(inbox => !inbox.allowed);
        const tagged = inboxes.filter(inbox => inbox.tags && inbox.tags.length > 0);
        const ready = allowed.filter(inbox => !(inbox.tags && inbox.tags.length > 0));
        const pageSize = 12;
        const start = clamp(state.inboxCursor - Math.floor(pageSize / 2), 0, Math.max(0, inboxes.length - pageSize));
        const visible = inboxes.slice(start, start + pageSize);

        console.log(this.colors.highlight('Inboxes'));
        console.log(this.colors.muted('─'.repeat(60)));
        console.log(`  ${this.colors.success(`[+] Allowed: ${allowed.length}`)}   ${this.colors.error(`[-] Blocked: ${blocked.length}`)}   ${this.colors.primary(`[TAGS] Tagged: ${tagged.length}`)}   Ready: ${ready.length}`);
        console.log('');

        if (inboxes.length === 0) {
          console.log(this.colors.warning('  No cached inboxes yet. Press R to fetch inboxes from Mailstack.'));
          return;
        }

        visible.forEach((inbox, offset) => {
          const index = start + offset;
          const selected = index === state.inboxCursor;
          const tags = (inbox.tags || []).map(tag => `[${tag.toUpperCase()}]`).join(' ');
          const marker = inbox.allowed ? '[+]' : '[-]';
          const prefix = selected ? this.colors.highlight('› ') : '  ';
          const color = !inbox.allowed ? this.colors.error : tags ? this.colors.primary : this.colors.success;
          console.log(`${prefix}${color(`${marker} ${inbox.email}${tags ? ` ${tags}` : ''}`)}`);
        });

        if (inboxes.length > pageSize) {
          console.log(this.colors.muted(`\n  Showing ${start + 1}-${start + visible.length}/${inboxes.length}`));
        }
      };

      const renderUtilities = () => {
        const rows = [
          {
            label: 'Workers',
            value: String(state.utilities.workers || 1),
            help: 'Space cycles 1 → 10 → 1'
          },
          {
            label: 'Browser mode',
            value: state.utilities.headless ? 'Headless' : 'Headed',
            help: 'Space toggles'
          }
        ];

        console.log(this.colors.highlight('Utilities'));
        console.log(this.colors.muted('─'.repeat(60)));
        rows.forEach((row, index) => {
          const selected = index === state.utilityCursor;
          const prefix = selected ? this.colors.highlight('› ') : '  ';
          console.log(`${prefix}${row.label.padEnd(14)} ${this.colors.primary(row.value.padEnd(10))} ${this.colors.muted(row.help)}`);
        });
      };

      const render = () => {
        refreshFromContext();
        process.stdout.write('\x1b[2J\x1b[H');
        this.printBox('Settings', { width: 62 });
        console.log('');
        renderTabs();
        console.log('');
        console.log(this.colors.muted('←/→ tabs   ↑/↓ select   Space edit/toggle   R refresh   Esc/Q back'));
        console.log(this.colors.muted(`• ${tabs[state.activeIndex].hint}`));
        if (state.message) console.log(this.colors.warning(`• ${state.message}`));
        if (state.busy) console.log(this.colors.primary('• Working...'));
        console.log('');

        if (tabs[state.activeIndex].value === 'inboxes') renderInboxes();
        else renderUtilities();
      };

      const onKeypress = async (_str, key = {}) => {
        if (state.busy) return;

        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(130);
        }

        const activeTab = tabs[state.activeIndex].value;

        if (key.name === 'left') {
          state.activeIndex = (state.activeIndex - 1 + tabs.length) % tabs.length;
          state.message = '';
          render();
          return;
        }

        if (key.name === 'right' || key.name === 'tab') {
          state.activeIndex = (state.activeIndex + 1) % tabs.length;
          state.message = '';
          render();
          return;
        }

        if (key.name === 'up') {
          if (activeTab === 'inboxes') {
            state.inboxCursor = clamp(state.inboxCursor - 1, 0, Math.max(0, state.inboxes.length - 1));
          } else {
            state.utilityCursor = clamp(state.utilityCursor - 1, 0, 1);
          }
          render();
          return;
        }

        if (key.name === 'down') {
          if (activeTab === 'inboxes') {
            state.inboxCursor = clamp(state.inboxCursor + 1, 0, Math.max(0, state.inboxes.length - 1));
          } else {
            state.utilityCursor = clamp(state.utilityCursor + 1, 0, 1);
          }
          render();
          return;
        }

        if (key.name === 'escape' || key.name === 'q') {
          cleanup();
          resolve('back');
          return;
        }

        if (activeTab === 'inboxes' && key.name === 'r') {
          if (!context.refreshInboxes) return;
          state.busy = true;
          state.message = 'Refreshing inboxes from Mailstack...';
          render();
          try {
            state.inboxes = await context.refreshInboxes();
            state.inboxCursor = clamp(state.inboxCursor, 0, Math.max(0, state.inboxes.length - 1));
            state.message = `Fetched ${state.inboxes.length} inbox(es)`;
          } catch (error) {
            state.message = `Refresh failed: ${error.message}`;
          }
          state.busy = false;
          render();
          return;
        }

        if (key.name === 'space' || key.name === 'return' || key.name === 'enter') {
          if (activeTab === 'inboxes') {
            const inbox = state.inboxes[state.inboxCursor];
            if (!inbox) return;
            if (context.toggleInbox) context.toggleInbox(inbox.email);
            state.message = `${inbox.email} toggled`;
            render();
            return;
          }

          if (state.utilityCursor === 0) {
            const currentWorkers = clamp(state.utilities.workers || 1, 1, 10);
            const workers = currentWorkers >= 10 ? 1 : currentWorkers + 1;
            saveUtilities({ workers });
            state.message = `Workers set to ${workers}`;
          } else {
            saveUtilities({ headless: !state.utilities.headless });
            state.message = `Browser mode set to ${state.utilities.headless ? 'headless' : 'headed'}`;
          }
          render();
          return;
        }

      };

      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('keypress', onKeypress);
      render();
    });
  }

  async selectAccount(accounts) {
    if (accounts.length === 0) {
      console.log(this.colors.warning('\n⚠️  No saved accounts found.'));
      return null;
    }

    const choices = accounts.map((acc, i) => ({
      title: acc.email,
      description: acc.name ? `${acc.name} (${acc.source})` : acc.source,
      value: i
    }));

    choices.push({ title: 'Cancel', value: -1 });

    const response = await prompts({
      type: 'select',
      name: 'index',
      message: 'Select an account:',
      choices,
      initial: 0
    }, {
      onCancel: () => process.exit(130)
    });

    return response.index >= 0 ? accounts[response.index] : null;
  }

  async confirmMFA() {
    const response = await prompts({
      type: 'confirm',
      name: 'autoPoll',
      message: 'Auto-poll MFA code from Mailstack?',
      initial: true
    }, {
      onCancel: () => process.exit(130)
    });

    return response.autoPoll;
  }

  async inputMFA() {
    const response = await prompts({
      type: 'text',
      name: 'code',
      message: 'Enter MFA code:',
      validate: v => v.length === 6 ? true : 'MFA code must be 6 digits'
    }, {
      onCancel: () => process.exit(130)
    });

    return response.code;
  }

  async input({ type = 'text', message, initial, validate }) {
    const question = {
      type,
      name: 'value',
      message,
    };

    if (initial !== undefined) {
      question.initial = initial;
    }

    if (validate) {
      question.validate = validate;
    }

    const response = await prompts(question, {
      onCancel: () => process.exit(130)
    });
    return response.value;
  }

  async registrationCount(maxAvailable, initial = 1) {
    const max = Math.max(1, Number(maxAvailable) || 1);
    const defaultCount = Math.min(Math.max(1, Number(initial) || 1), max);

    if (max === 1) {
      return 1;
    }

    const response = await prompts({
      type: 'number',
      name: 'count',
      message: `How many accounts should be registered? (1-${max})`,
      initial: defaultCount,
      min: 1,
      max,
      validate: value => {
        if (!Number.isInteger(value)) return 'Enter a whole number';
        if (value < 1) return 'Enter at least 1';
        if (value > max) return `Only ${max} inbox(es) are available`;
        return true;
      }
    }, {
      onCancel: () => process.exit(130)
    });

    return response.count;
  }

  async confirm(message, initial = true) {
    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message,
      initial
    }, {
      onCancel: () => process.exit(130)
    });

    return response.value;
  }

  status(message) {
    console.log(this.colors.muted('   ') + message);
  }

  step(message) {
    console.log(this.colors.primary('→ ') + message);
  }

  substep(message) {
    console.log(this.colors.muted('  • ') + message);
  }

  success(message) {
    console.log(this.colors.success('✓ ') + message);
  }

  error(message) {
    console.log(this.colors.error('✗ ') + message);
  }

  warning(message) {
    console.log(this.colors.warning('! ') + message);
  }

  progress(current, total, message) {
    const percentage = Math.round((current / total) * 100);
    const bar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
    console.log(`   [${bar}] ${percentage}% ${message}`);
  }

  divider() {
    console.log(this.colors.muted('─'.repeat(60)));
  }

  clearLines(count = 1) {
    process.stdout.write(`\x1b[${count}A\x1b[K`);
  }

  async pause() {
    await prompts({
      type: null,
      name: '_',
      message: 'Press Enter to continue...'
    }, {
      onCancel: () => process.exit(130)
    });
  }

  showProgress(message) {
    process.stdout.write(`\r\x1b[K${this.colors.primary('⟳')} ${message}`);
  }

  clearProgress() {
    process.stdout.write('\r\x1b[K');
  }
}

module.exports = new TUI();
