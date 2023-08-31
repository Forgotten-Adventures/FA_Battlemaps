/**
 * Forgotten Adventures Patron Download Module
 */

import { libWrapper } from './shim.js';

const baseURL = `https://api.forgotten-adventures.net`;

//Helpers
Handlebars.registerHelper('ifeq', function (a, b, options) {
  if (a == b) {
    return options.fn(this);
  }
  return options.inverse(this);
});
Handlebars.registerHelper('facontains', function (needle, haystack, options) {
  needle = Handlebars.escapeExpression(needle);
  haystack = Handlebars.escapeExpression(haystack);
  if (typeof needle === 'string') {
    needle = needle.split(',')
      .map(str => str.trim())
      .filter(s => s);
  }
  if (typeof haystack === 'string') {
    haystack = haystack.split(',')
      .map(str => str.trim())
      .filter(s => s);
  }
  if (!options.hash.exact) {
    if (haystack.includes('all')) {
      return options.fn(this);
    }
    return haystack.every(val => needle.map(str => str.slugify())
      .includes(val)) ?
      options.fn(this) :
      options.inverse(this);
  }
  return haystack.some(val => needle.map(str => str.slugify())
    .includes(val)) ?
    options.fn(this) :
    options.inverse(this);
});
Handlebars.registerHelper('slugify', function (value) {
  return value.slugify();
});
Handlebars.registerHelper('faFindById', function (needle, haystack) {
  return haystack.find(val => val.id === needle);
});
Handlebars.registerHelper('breaklines', function(text) {
  text = Handlebars.Utils.escapeExpression(text);
  text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
  return new Handlebars.SafeString(text);
});
Handlebars.registerHelper('escape', function(variable) {
  return variable?.replace(/(['"])/g, '\\$1');
});

/**
 * Format bytes as human-readable text.
 * @see https://stackoverflow.com/a/14919494/191306
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 * @return {string} Formatted string.
 */
function HumanFileSize(bytes, si = true, dp = 1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
    );

  return bytes.toFixed(dp) + ' ' + units[u];
}

Handlebars.registerHelper('HumanFileSize', function (options) {
  return HumanFileSize(options.hash.bytes, options.hash.si, options.hash.dp);
});

/**
 * Once the game has initialized, set up our module
 */
Hooks.once('init', () => {
  libWrapper.register(FABattlemaps.ID, 'Compendium.prototype._getEntryContextOptions', function (
    wrapped,
    ...args
  ) {
    const contextOptions = wrapped(...args);
    if (this.collection.metadata.package !== FABattlemaps.ID || this.collection.documentName !== 'Scene') {
      // The compendium doesn't belong to this module, or it's not a Scene compendium
      return contextOptions;
    }
    if (!Object.values(game.faBattlemaps.battlemaps).length) {
      new FABattlemaps();
    }
    for (const option of contextOptions) {
      if (option.name === 'COMPENDIUM.ImportEntry') {
        option.callback = li => {
          const collection = game.collections.get(this.collection.documentName);
          const id = li.data('document-id');
          return FADownloader.handleExistingScene('', id, async (sceneId, sceneName) => {
            const battlemap = Object.values(game.faBattlemaps.battlemaps)
              .find(battlemap => battlemap.name === sceneName);
            if (!battlemap) {
              return await collection.importFromCompendium(this.collection, sceneId, {}, { keepId: true });
            }
            new FABattlemaps().render(true);
            setTimeout(() => {
              new FADownloader(battlemap.id).render(true);
            }, 500);
          });
        };
      }
    }
    return contextOptions;
  }, 'WRAPPER');

  libWrapper.register(FABattlemaps.ID, 'CompendiumDirectory.prototype._getEntryContextOptions', function (
    wrapped,
    ...args
  ) {
    const contextOptions = wrapped(...args);
    if (!game.user.isGM) {
      return contextOptions;
    }
    const i = contextOptions.findIndex(c => c.name === 'COMPENDIUM.ImportAll');
    // Limit importAll to only work for compendiums that do not belong to FA Battlemaps
    contextOptions[i].condition = li => {
      return li.data('pack') !== 'fa-battlemaps.maps';
    };
    return contextOptions;
  }, 'WRAPPER');

  FABattlemaps.initialize();
});
Hooks.on('preCreateScene', (scene, data, options) => {
  if (scene.getFlag('core', 'sourceId')
      ?.match(/Compendium.fa_battlemaps.maps/) ||
    scene.getFlag('core', 'sourceId')
      ?.match(/Compendium.fa-battlemaps.maps/)) {
    options.keepId = true;
    options.keepEmbeddedIds = true;
  }
});
Hooks.on('renderSidebarTab', async (app, html) => {
  if (game.user.isGM && (app?.id ?? app?.options?.id) === 'scenes' && game.settings.get(FABattlemaps.ID, 'sidebar-button')) {
    html.find('.fa-battlemaps')
      .remove();
    const button = $('<button class="fa-battlemaps"><i class="fas fa-battlemaps"></i> FA Battlemaps</button>');
    button.on('click', () => {
      new FABattlemaps().render(true);
    });
    html.find('.directory-footer')
      .append(button);
  }
});

Hooks.on('renderCompendium', async function (e) {
  let packCode = e.metadata.id || e.metadata.package + '.' + e.metadata.name;
  if (packCode === 'fa-battlemaps.maps') {
    // Render the fancy battlemap list rather than the boring compendium one
    new FABattlemaps().render(true);
    return e.close({ force: true });
  }
});

class FABattlemaps extends FormApplication {
  static ID = 'fa-battlemaps';

  static TEMPLATES = {
    main: `modules/${this.ID}/templates/main.hbs`,
    mapDownload: `modules/${this.ID}/templates/mapDownload.hbs`,
    gallery: `modules/${this.ID}/templates/gallery.hbs`,
    preview: `modules/${this.ID}/templates/preview.hbs`,
  };

  static SETTINGS = {
    clientID: 'NKDhTqQyf4i2ylsM6JQ1JFxNmjGFShGSwe5wHqbeypvI0JnNt-WcbFLrLDLj6-ey',
  };
  STATE = {
    selectedTags: ['all'],
    filterState: '',
    faId: null,
  };

  constructor(object = {}, options = {}) {
    super(object, options);

    this.loading = true;

    Promise.allSettled([this.loadTags(), this.loadMaps()])
      .then(results => {
        if (!results[0]?.value) {
          const existingTags = JSON.parse(localStorage.getItem(`${FABattlemaps.ID}.cache-tags`));
          if (existingTags?.length) {
            console.error(`${FABattlemaps.ID} | ${game.i18n.localize('FABattlemaps.LoadErrorFallbackTags')}`);
            game.faBattlemaps.tags = new Set(existingTags);
          }
        }
        if (!results[1]?.value) {
          const existingMaps = JSON.parse(localStorage.getItem(`${FABattlemaps.ID}.cache-maps`));
          if (existingMaps?.length) {
            console.error(`${FABattlemaps.ID} | ${game.i18n.localize('FABattlemaps.LoadErrorFallbackMaps')}`);
            game.faBattlemaps.battlemaps = existingMaps;
          }
        }
      })
      .finally(() => {
        for (const tag of game.faBattlemaps.tags) {
          if (['All', 'Free', 'Premium'].includes(tag)) {
            continue;
          }
          // Remove any tag that doesn't have a battlemap associated with it
          if (!game.faBattlemaps.battlemaps.some((map) => map.tags.includes(tag))) {
            game.faBattlemaps.tags.delete(tag);
          }
        }

        this.loading = false;
        this.render(false);
      });
  }

  async loadTags() {
    const tags = await this.getTags();
    if (tags?.length) {
      game.faBattlemaps.tags = new Set(tags);
      localStorage.setItem(`${FABattlemaps.ID}.cache-tags`, JSON.stringify(tags));
      return true;
    }
    return false;
  }

  async loadMaps() {
    const battlemaps = await this.getBattlemaps();
    if (battlemaps?.length) {
      game.faBattlemaps.battlemaps = battlemaps;
      localStorage.setItem(`${FABattlemaps.ID}.cache-maps`, JSON.stringify(battlemaps));
      return true;
    }
    return false;
  }

  static initialize() {
    loadTemplates(Object.values(FABattlemaps.TEMPLATES));

    game.settings.registerMenu(FABattlemaps.ID, 'show-asset-downloader', {
      name: game.i18n.localize('FABattlemaps.ShowAssetDownloaderName'),
      label: game.i18n.localize('FABattlemaps.ShowAssetDownloaderLabel'),
      hint: game.i18n.localize('FABattlemaps.ShowAssetDownloaderHint'),
      icon: 'fas fa-cloud-download-alt',
      type: FABattlemaps,
      restricted: true,
    });

    game.settings.register(FABattlemaps.ID, 'user-id', {
      scope: 'client',
      type: String,
      default: '',
    });

    game.settings.register(FABattlemaps.ID, 'hq', {
      name: game.i18n.localize('FABattlemaps.HighQualityMapsName'),
      hint: game.i18n.localize('FABattlemaps.HighQualityMapsHint'),
      scope: 'client',
      config: true,
      type: Boolean,
      restricted: true,
      default: false,
    });

    game.settings.register(FABattlemaps.ID, 'sidebar-button', {
      name: game.i18n.localize('FABattlemaps.ShowSidebarButtonName'),
      hint: game.i18n.localize('FABattlemaps.ShowSidebarButtonHint'),
      scope: 'client',
      config: true,
      type: Boolean,
      restricted: true,
      default: true,
    });

    let uuiDv4 = game.settings.get(FABattlemaps.ID, 'user-id');
    if (!uuiDv4) {
      game.settings.set(FABattlemaps.ID, 'user-id', FABattlemaps.UUIDv4());
    }

    game.faBattlemaps = {
      battlemaps: [],
      tags: new Set(['All', 'Free', 'Premium']),
      user: {
        has_free: true,
      },
      auth: {
        iteration: 0,
        timer: null,
        dialog: null,
      },
    };
  }

  /**
   * Return a UUID v4
   * @returns {string}
   */
  static UUIDv4() {
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16),
    );
  }

  /**
   * @override
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      closeOnSubmit: false,
      id: 'fa-battlemaps',
      classes: ['fa-battlemaps'],
      submitOnClose: false,
      template: FABattlemaps.TEMPLATES.main,
      title: game.i18n.localize('FABattlemaps.WindowTitle'),
      userId: game.userId,
      resizable: true,
      height: window.innerHeight - 150,
      width: Math.max(670, Math.min(Math.floor(((window.innerWidth * 0.8) - 220) / 220) * 220, 1100)),
      scrollY: [".u-section"],
    });
  }

  async patreonLogout(event) {
    event.preventDefault();

    // Cycle the userId to "log out"
    await game.settings.set(FABattlemaps.ID, 'user-id', FABattlemaps.UUIDv4());

    this.html.find('.u-login')
      .removeClass('u-login-connected')
      .addClass('u-icon-desaturate')
      .attr('title', null);
    game.faBattlemaps.user = {
      has_free: true,
    };
  }

  async patreonLogin(event) {
    event.preventDefault();
    if (game.faBattlemaps.auth.timer) {
      clearInterval(game.faBattlemaps.auth.timer);
    }
    if (game.faBattlemaps.auth.dialog) {
      game.faBattlemaps.auth.dialog.close({ force: true });
      game.faBattlemaps.auth.dialog = null;
    }

    let uuiDv4 = game.settings.get(FABattlemaps.ID, 'user-id');
    if (uuiDv4) {
      if (await this.checkPatreonStatus(uuiDv4)) {
        return;
      }
    }

    uuiDv4 = FABattlemaps.UUIDv4();
    await game.settings.set(FABattlemaps.ID, 'user-id', uuiDv4);
    const callback = `${baseURL}/api/v1/patreon`;
    const patreonURL = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${FABattlemaps.SETTINGS.clientID}&redirect_uri=${callback}&scope=identity&state=${uuiDv4}`;
    window.open(patreonURL, '_blank');

    game.faBattlemaps.auth.dialog = new Dialog({
      title: game.i18n.localize('FABattlemaps.PatreonLoginWaitTitle'),
      content: `<p>${game.i18n.localize('FABattlemaps.PatreonLoginWaitContent')}</p>`,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize('Close'),
          callback: () => {
          },
        },
      },
      default: 'close',
      rejectClose: false,
    });
    game.faBattlemaps.auth.dialog.render(true);

    const parent = this;
    game.faBattlemaps.auth.iteration = 0;
    game.faBattlemaps.auth.timer = setInterval(async function () {
      // stop after 2 minutes maximum
      if (game.faBattlemaps.auth.iteration > 60) {
        clearInterval(game.faBattlemaps.auth.timer);
        game.faBattlemaps.auth.dialog.close({ force: true });
        game.faBattlemaps.auth.dialog = null;
        Dialog.prompt({
          title: game.i18n.localize('FABattlemaps.PatreonLoginTimeoutTitle'),
          content: `<p>${game.i18n.localize('FABattlemaps.PatreonLoginTimeoutContent')}</p>`,
          label: game.i18n.localize('Close'),
          callback: () => {
          },
          rejectClose: false,
        });
        return;
      }

      game.faBattlemaps.auth.iteration++;

      if (await parent.checkPatreonStatus(uuiDv4)) {
        clearInterval(game.faBattlemaps.auth.timer);
        game.faBattlemaps.auth.dialog.close({ force: true });
        game.faBattlemaps.auth.dialog = null;
      }
    }, 2000);
  }

  async checkPatreonStatus(uuiDv4) {
    try {
      const response = await fetch(`${baseURL}/api/v1/users/${uuiDv4}/ready`);
      if (response && response.status === 200) {
        const json = await response.json();
        if (!json?.error && json?.expires_in > 0) {
          this.html.find('.u-login')
            .removeClass('u-icon-desaturate')
            .addClass('u-login-connected')
            .attr('title', game.i18n.localize('FABattlemaps.PatreonLogout'));
          game.faBattlemaps.user = json;
          return true;
        }
      }
    } catch (e) {
      console.log(`${FABattlemaps.ID} | ${game.i18n.localize('FABattlemaps.PatreonLoginStatusError')} |`, e);
    }
    return false;
  }

  selectTag(event) {
    event.preventDefault();

    const tagId = event.currentTarget.id;
    if (tagId === 'all') {
      this.STATE.selectedTags = ['all'];
    } else {
      if (this.STATE.selectedTags.includes(tagId)) {
        this.STATE.selectedTags = this.STATE.selectedTags.filter((tag) => tag !== tagId);
      } else {
        this.STATE.selectedTags.push(tagId);
      }

      // Remove the all tag if there are other tags
      if (this.STATE.selectedTags.length > 1) {
        this.STATE.selectedTags = this.STATE.selectedTags.filter(tag => tag !== 'all');
      }

      if (!this.STATE.selectedTags.length) {
        this.STATE.selectedTags = ['all'];
      }
    }
    this.render(false);
  }

  selectPreview(event) {
    event.preventDefault();

    const faId = $(event.currentTarget).closest('.u-gallery-item').data('faId');
    if (faId) {
      this.STATE.faId = faId;
    }
    this.render(false);
  }

  resetPreview(event) {
    event.preventDefault();
    this.STATE.faId = null;
    this.render(false);
  }

  download(event) {
    event.preventDefault();
    event.stopPropagation();

    const target = $(event.currentTarget);
    const faId = target.data('faId') || target.closest('.u-gallery-item').data('faId');
    if (!faId) {
      return;
    }

    new FADownloader(faId).render(true);
  }

  /**
   * @override
   */
  activateListeners(html) {
    this.html = html;
    super.activateListeners(html);

    html.on('click', '.u-login:not(.u-login-connected)', this.patreonLogin.bind(this));
    html.on('click', '.u-login-connected', this.patreonLogout.bind(this));
    html.on('click', '.u-tags button', this.selectTag.bind(this));
    html.on('click', '.u-gallery-item:not(.u-download)', this.selectPreview.bind(this));
    html.on('click', '.u-download', this.download.bind(this));
    html.on('click', '.u-back-gallery', this.resetPreview.bind(this));

    const uuiDv4 = game.settings.get(FABattlemaps.ID, 'user-id') || FABattlemaps.UUIDv4();
    this.checkPatreonStatus(uuiDv4);
  }

  /**
   * @override
   */
  async getData(options) {
    // Utilise a promise to give a small amount of time for the data to be loaded in the background
    // but show the loading screen after 250ms if we are still waiting.
    await new Promise(resolve => {
      if (!this.loading) {
        resolve();
      } else {
        setTimeout(resolve, 250);
      }
    });
    return {
      loading: this.loading,
      maps: game.faBattlemaps.battlemaps,
      state: this.STATE,
      tags: Array.from(game.faBattlemaps.tags)
        .map(tag => ({
          value: tag.slugify(),
          label: tag,
        })),
    };
  }

  async getTags() {
    try {
      const response = await fetch(`${baseURL}/api/v1/battlemaps/tags`, {
        method: 'GET',
      });
      return await response.json();
    } catch (e) {
      console.error(`${FABattlemaps.ID} - ${game.i18n.localize('FABattlemaps.TagGetFailed')}`, e);
      return [];
    }
  }

  async getBattlemaps() {
    try {
      const response = await fetch(`${baseURL}/api/v1/battlemaps/list`, {
        method: 'GET',
      });
      return await response.json();
    } catch (e) {
      console.error(`${FABattlemaps.ID} - ${game.i18n.localize('FABattlemaps.BattlemapsGetFailed')}`, e);
      return [];
    }
  }
}

class FADownloader extends FormApplication {
  static FILE_STATUS_DOWNLOADED = 'Downloaded';
  static FILE_STATUS_PENDING = 'Pending';
  static FILE_STATUS_PROCESSING = 'Processing';
  static FILE_STATUS_ERRORED = 'Errored';

  constructor(battlemapId, object = {}, options = {}) {
    super(object, options);

    if (battlemapId) {
      this.battlemap = game.faBattlemaps.battlemaps.find(battlemap => battlemap.id === battlemapId);
      if (!this.battlemap) {
        this.error = game.i18n.localize('FABattlemaps.BattlemapNotFound');
        return;
      }
    }

    this.hq = game.settings.get(FABattlemaps.ID, 'hq');
    this.status = game.i18n.localize('FABattlemaps.DownloaderStatusLoading');
    this.files = new Map();
    this.error = null;
    this.loggedIn = !!game.settings.get(FABattlemaps.ID, 'user-id') && (game.faBattlemaps.user.expires_in || 0) > 0;
    this.authorised = !!game.settings.get(FABattlemaps.ID, 'user-id') && (
      (this.battlemap.access === 'Free' && !!game.faBattlemaps.user.has_free) ||
      (this.battlemap.access === 'Premium' && !!game.faBattlemaps.user.has_premium)
    );

    if (!this.authorised) {
      this.status = game.i18n.localize('FABattlemaps.DownloaderStatusAuthError');
      return;
    }

    const moduleVersion = game.modules.get(FABattlemaps.ID).version ?? game.modules.get(FABattlemaps.ID).data.version;
    const mapVersion = this.battlemap.version || '1.0.18';
    if (isNewerVersion(mapVersion, moduleVersion)) {
      this.wrongVersion = game.i18n.format('FABattlemaps.DownloaderStatusWrongVersion', {version: mapVersion});
      this.status = game.i18n.localize('FABattlemaps.DownloaderStatusWrongVersionShort');
      return;
    }

    this.downloader = new ConcurrentDownloader({
      onDownloaded: async (data) => {
        if (!data.fileDetails?.file?.path) {
          return;
        }
        const file = this.files.get(data.fileDetails.file.path);
        if (!file) {
          return;
        }
        file.status = FADownloader.FILE_STATUS_DOWNLOADED;
        file.percentComplete = 100;
        this.render(false);

        let lastModified = new Date();
        if (data.fileDetails.file.lastModified) {
          const d = new Date(data.fileDetails.file.lastModified);
          if (d instanceof Date && !isNaN(d)) {
            lastModified = d;
          }
        }
        try {
          if (data.fileDetails.file.isHQ) {
            // Rename the file to the standard one so that the maps still work
            data.fileDetails.file.path = data.fileDetails.file.path.replace('/Maps_HQ/', '/Maps/');
          }
          const folder = data.fileDetails.file.path.substring(0, data.fileDetails.file.path.lastIndexOf('/'));
          const filename = data.fileDetails.file.path.split('/').pop();
          await FADownloader.uploadFile(new File([data.blob], filename, {
            type: data.blob.type,
            lastModified: lastModified,
          }), folder);
        } catch (e) {
          console.error(`${FABattlemaps.ID} - ${game.i18n.format('FABattlemaps.UploadFailed', {
            file: data.fileDetails.file.path,
          })}`, e);
        }
      },
      onFileExists: (data) => {
        const file = this.files.get(data?.path);
        if (!file) {
          return;
        }
        file.status = data?.status ?? file.status;
        file.percentComplete = data?.percentComplete ?? file.percentComplete;
        this.render(false);
      },
      onProgress: (data) => {
        if (data.complete || !data.fileDetails?.file?.path) {
          return;
        }
        const file = this.files.get(data.fileDetails.file.path);
        if (!file) {
          return;
        }
        const significantChange = (data.percentComplete - file.percentComplete) > 5;
        file.status = FADownloader.FILE_STATUS_PROCESSING;
        file.percentComplete = data.percentComplete || 0;
        if (significantChange) {
          this.render(false);
        }
      },
    });

    this.getFiles()
      .then(files => {
        this.files = files;
        if (!files?.size) {
          this.error = true;
          this.status = game.i18n.localize('FABattlemaps.BattlemapsListFailed');
          return this.render(false);
        }
        this.render(false);

        this.status = game.i18n.format('FABattlemaps.DownloaderStatusDownloading', {
          count: files?.size,
        });
        this.downloader.Process(battlemapId, Array.from(files.values()))
          .then(() => {
            this.onComplete();
          });
      });
  }

  /**
   * The callback to call after prompting the user what to do about the existing scene.
   * @callback existingSceneCallback
   * @param {string} sceneId The ID of the scene.
   * @param {string} sceneName The name of the scene.
   */

  /**
   * Checks to see if the scene exists and prompts the user what to do about it.
   * @param {string} sceneName The name of the scene.
   * @param {string} sceneId  The ID of the scene.
   * @param {existingSceneCallback} callback
   */
  static async handleExistingScene(sceneName, sceneId, callback) {
    const pack = game.packs.get(`${FABattlemaps.ID}.maps`);
    const sceneIndex = pack.index.find(i => i._id === sceneId || i.name === sceneName);
    if (!sceneId) {
      sceneId = sceneIndex?._id;
    }
    if (!sceneName) {
      sceneName = sceneIndex?.name;
    }
    if (!sceneId) {
      return ui.notifications.error(game.i18n.format('FABattlemaps.ImportNotFound', {
        name: sceneName,
      }), { permanent: true });
    }
    if (!sceneName) {
      return ui.notifications.error(game.i18n.format('FABattlemaps.ImportNotFound', {
        name: sceneId,
      }), { permanent: true });
    }

    const existingScene = game.scenes.getName(sceneName) || game.scenes.get(sceneId);
    if (existingScene) {
      new Dialog({
        title: game.i18n.format('FABattlemaps.ImportExistsTitle', {
          name: sceneName,
        }),
        content: `<h2>${game.i18n.localize('FABattlemaps.ImportExistsContent1')}</h2>` +
          `<p>${game.i18n.format('FABattlemaps.ImportExistsContent2', {
            name: sceneName,
          })}</p>` +
          `<p>${game.i18n.localize('FABattlemaps.ImportExistsContent3')}</p>`,
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize('FABattlemaps.ImportYes'),
            callback: async () => {
              await existingScene.delete();
              callback(sceneId, sceneName);
            },
          },
          close: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize('FABattlemaps.ImportNo'),
            callback: () => {
            },
          },
        },
        default: 'yes',
        rejectClose: false,
      }).render(true);
    } else {
      callback(sceneId, sceneName);
    }
  }

  async onComplete() {
    this.status = game.i18n.localize('FABattlemaps.DownloaderStatusComplete');
    setTimeout(() => {
      this.render(false);
    }, 0);

    await FADownloader.handleExistingScene(this.battlemap.name, '', async (sceneId, sceneName) => {
      await game.scenes.importFromCompendium(game.packs.get('fa-battlemaps.maps'), sceneId, {}, { keepId: true });
      const scene = game.scenes.get(sceneId);
      if (scene) {
        // Generate thumbnail
        const thumb = await scene.createThumbnail();
        await scene.update({"thumb": thumb.thumb});
      }
      setTimeout(() => {
        this.close({ force: true });
        ui.sidebar.activateTab('scenes');
        Dialog.prompt({
          title: game.i18n.localize('FABattlemaps.WindowTitle'),
          content: `<p>${game.i18n.format('FABattlemaps.ImportComplete', {
            name: this.battlemap.name,
          })}</p>`,
          label: game.i18n.localize('Close'),
          callback: () => {
          },
          rejectClose: false,
        });
      }, 0);
    });
  }

  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      id: `fa-battlemaps-downloader-${Math.floor(Math.random() * 1000)}`,
      classes: ['fa-battlemaps'],
      width: 700,
      height: 'auto',
      closeOnSubmit: false,
      submitOnClose: false,
      template: FABattlemaps.TEMPLATES.mapDownload,
      title: game.i18n.localize('FABattlemaps.WindowTitle'),
      resizable: true,
      scrollY: ['.u-section'],
    });
  }

  /**
   * @override
   */
  async getData(options) {
    return {
      battlemap: mergeObject(this.battlemap, {
        files: Array.from(this.files.values()),
      }),
      error: this.error,
      status: this.status,
      authorised: this.authorised,
      wrongVersion: this.wrongVersion,
      loggedIn: this.loggedIn,
    };
  }

  /**
   * @override
   */
  activateListeners(html) {
    super.activateListeners(html);
  }

  static IsUsingTheForge = (typeof ForgeVTT !== 'undefined' && ForgeVTT.usingTheForge);

  async getFiles() {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const battlemapFiles = await FADownloader.getBattlemapFiles(this.battlemap.id);
    const mergedFiles = new Map();

    const animationFiles = battlemapFiles?.files?.animations || [];
    const audioFiles = battlemapFiles?.files?.audio || [];
    const imageFiles = battlemapFiles?.files?.images || [];
    if (!animationFiles.length && !audioFiles.length && !imageFiles.length) {
      console.error(`${FABattlemaps.ID} - ${game.i18n.localize('FABattlemaps.BattlemapsListFailed')}`, battlemapFiles);
      return mergedFiles;
    }
    for (const file of animationFiles.concat(audioFiles.concat(imageFiles))) {
      file.status = FADownloader.FILE_STATUS_PENDING;
      file.percentComplete = 0;
      if (!file.size) {
        continue;
      }
      mergedFiles.set(file.path, file);
    }

    return mergedFiles;
  }

  static async getBattlemapFiles(battlemapId) {
    try {
      const userId = game.settings.get(FABattlemaps.ID, 'user-id');
      let url = `${baseURL}/api/v1/battlemaps/list-files/${battlemapId}?userId=${userId}`;
      if (game.settings.get(FABattlemaps.ID, 'hq')) {
        url += '&hq=true';
      }
      const response = await fetch(url, {
        method: 'GET',
      });
      return await response.json();
    } catch (e) {
      console.error(`${FABattlemaps.ID} - ${game.i18n.localize('FABattlemaps.BattlemapsListFailed')}`, e);
      return {
        files: {},
      };
    }
  }

  static async getFileDetails(battlemapId, file) {
    try {
      const userId = game.settings.get(FABattlemaps.ID, 'user-id');
      const response = await fetch(`${baseURL}/api/v1/battlemaps/get-file/${battlemapId}/${encodeURIComponent(file.path)}?userId=${userId}`, {
        method: 'GET',
      });
      return await response.json();
    } catch (e) {
      console.error(`${FABattlemaps.ID} - ${game.i18n.localize('FABattlemaps.GetFileDetailsFailed')}`, e);
      return {};
    }
  }

  static async fileExists(file) {
    const path = file.path.replace(/ /g, '%20');
    try {
      const parentFolder = await FilePicker.browse(
        FADownloader.getFilePickerSource(path),
        path,
        Object.assign(FADownloader.getFilePickerOptions(path), {
          wildcard: true,
        }),
      );
      if (parentFolder.files.includes(path)) {
        // Check the filesize
        const response = await fetch(path, { method: 'HEAD' });
        return Number(response.headers.get('content-length')) === file.size;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  static async createFolderRecursive(path) {
    const source = FADownloader.getFilePickerSource(path);
    const options = FADownloader.getFilePickerOptions(path);
    const folders = path.split('/');
    let curFolder = '';
    for (const f of folders) {
      const parentFolder = await FilePicker.browse(source, curFolder, options);
      curFolder += (curFolder.length > 0 ? '/' : '') + f;
      const dirs = parentFolder.dirs.map((d) => decodeURIComponent(d));
      if (!dirs.includes(decodeURIComponent(curFolder))) {
        try {
          console.log(`${FABattlemaps.ID} - ${game.i18n.format('FABattlemaps.ImportCreatingFolder', {
            folder: curFolder,
          })}`);
          await FilePicker.createDirectory(source, curFolder, options);
        } catch (e) {
          // Concurrency means there's a decent change we try to create the folder at the same time. Ignore the error.
        }
      }
    }
  }

  static async uploadFile(file, folderPath, options = {}) {
    const source = FADownloader.getFilePickerSource(folderPath);
    options = Object.assign(FADownloader.getFilePickerOptions(folderPath), options);
    await FADownloader.createFolderRecursive(folderPath);

    if (typeof ForgeVTT != 'undefined' && ForgeVTT.usingTheForge) {
      return await ForgeVTT_FilePicker.upload(source, folderPath, file, options, { notify: false });
    } else {
      return await FilePicker.upload(source, folderPath, file, options, { notify: false });
    }
  }

  static getFilePickerSource(target) {
    if (
      FADownloader.IsUsingTheForge &&
      target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)
    ) {
      return 'forgevtt';
    }

    try {
      if (FilePicker.matchS3URL(target)) {
        return 's3';
      }
    } catch (e) {
      // NOOP
    }

    return 'data';
  }

  static getFilePickerOptions(target) {
    let options = {};
    let bucket;
    try {
      // Check for s3 matches
      const s3Match = FilePicker.matchS3URL(target);
      if (s3Match) {
        bucket = s3Match.groups.bucket;
      }
    } catch (e) {
      // NOOP
    }
    if (bucket) {
      options.bucket = bucket;
    }

    return options;
  }
}

class ConcurrentDownloader {
  /**
   * @param {number} concurrency - The number of concurrent downloads to process
   * @param {function(ProgressDownloaded): void} onDownloaded - A function to call each time a download completes.
   * @param {function(ProgressFileExists): void} onFileExists - A function to call each time a file already exists.
   * @param {function(ProgressUpdate): void} onProgress - A function to call with progress updates.
   */
  constructor({
    concurrency = 5,
    onDownloaded = async () => {
    },
    onFileExists = () => {
    },
    onProgress = () => {
    },
  } = {}) {
    this.running = 0;
    this.concurrency = concurrency;
    this.resolve = null;
    this.reject = null;
    /**
     * The function to call each time a download completes.
     * @type {function(ProgressDownloaded): void}
     */
    this.onDownloaded = onDownloaded;
    /**
     * The function to call each time a download completes.
     * @type {function(ProgressFileExists): void}
     */
    this.onFileExists = onFileExists;
    /**
     * The function to call with progress updates.
     * @type {function(ProgressUpdate): void}
     */
    this.onProgress = onProgress;
  }

  /**
   * @typedef {object} ProgressFileExists
   * @property {string} path - The path of the file.
   * @property {number} percentComplete - The percentage of the download that is complete.
   * @property {string} status - The status of the download.
   */

  /**
   * @typedef ProgressDownloaded
   * @property {object} fileDetails - The details of the file this update belongs to.
   * @property {Blob} blob - The binary data blob.
   */

  /**
   * @typedef ProgressUpdate
   * @property {object} fileDetails - The details of the file this update belongs to.
   * @property {number} percentComplete - The percentage of the download that is complete.
   * @property {number} speed - The bytes per second.
   * @property {boolean} complete - Whether the download has completed.
   */

  /**
   * Process the pending urls. Be sure to add all the URLs prior to calling Process.
   * @param {string} battlemapId - The id of the battlemap.
   * @param {Array.<object>} files - The files to download.
   * @return {Promise<void>}
   */
  async Process(battlemapId, files) {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      // No urls to process
      if (!files.length) {
        return this.resolve();
      }

      const resolveAsset = async (iterator) => {
        for (let [, file] of iterator) {
          if (await FADownloader.fileExists(file)) {
            console.log(`${FABattlemaps.ID} - ${game.i18n.format('FABattlemaps.UploadAlreadyExists', {
              file: file.path.replace(/ /g, '%20'),
            })}`);
            this.onFileExists({
              path: file.path,
              percentComplete: 100,
              status: FADownloader.FILE_STATUS_DOWNLOADED,
            });
            continue;
          }
          const fileDetails = await FADownloader.getFileDetails(battlemapId, file);
          if (!fileDetails?.url) {
            this.onFileExists({
              path: file.path,
              percentComplete: 0,
              status: FADownloader.FILE_STATUS_ERRORED,
            });
            continue;
          }
          const blob = await this._download(fileDetails);
          if (blob) {
            await this.onDownloaded({
              fileDetails,
              blob,
            });
          }
        }
      };

      // Operate with concurrency
      const iterator = files.entries();
      const workers = new Array(Math.min(this.concurrency, files.length))
        .fill(iterator)
        .map(resolveAsset);

      Promise.allSettled(workers)
        .then(() => {
          return this.resolve();
        });
    });
  }

  /**
   * Download the requested absolute URL, providing progress updates to {@link onProgress}
   * @param {object} fileDetails - The details of the file to download.
   * @return {Promise<{Blob}>} The binary data of the requested URL.
   * @private
   */
  async _download(fileDetails) {
    return new Promise((resolve, reject) => {
      const oReq = new XMLHttpRequest();
      oReq.responseType = 'blob';

      let speed = null;
      let previousLoaded = 0;
      const TIME_CONSTANT = 5;
      oReq.addEventListener('progress', (e) => {
        let percentComplete = 0;
        // Only able to compute progress information if the total size is known
        if (e.lengthComputable && e.total) {
          percentComplete = Math.floor((e.loaded / e.total) * 100);
        }

        if (speed === null) {
          speed = e.loaded - previousLoaded;
        } else {
          speed += (e.loaded - previousLoaded - speed) / TIME_CONSTANT;
        }

        this.onProgress({
          fileDetails,
          percentComplete,
          speed,
          complete: false,
        });
      });
      oReq.addEventListener('load', () => {
        this.onProgress({
          fileDetails,
          percentComplete: 100,
          speed: 0,
          complete: true,
        });
        resolve(oReq.response);
      });
      oReq.addEventListener('error', (e) => {
        reject(e);
      });
      oReq.addEventListener('abort', (e) => {
        reject(e);
      });
      oReq.open('GET', fileDetails.url);
      oReq.send();
    });
  }
}
