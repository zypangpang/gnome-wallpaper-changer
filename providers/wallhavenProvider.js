const Lang = imports.lang;

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Soup = imports.gi.Soup;

const Self = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Self.imports.utils;
const WallpaperProvider = Self.imports.wallpaperProvider;

function getRndInteger(min, max) {
  return Math.floor(Math.random() * (max - min) ) + min;
}

const OPTIONS = {
  query: "",
  categories: '100',
  purity: '100',
  resolution: "",
  ratio: "16x9",
  sorting: "random",
  order: "desc",

  toParameterString: function () {
    return "categories=" + this.categories
      + "&purity=" + this.purity
      + "&resolutions=" + this.resolution
      + "&ratios=" + this.ratio
      + "&sorting=" + this.sorting
      + "&order=" + this.order
      + "&q=" + this.query
	  + "&seed=1" + getRndInteger(1,5000);
  }
}

const Provider = new Lang.Class({
  Name: 'Wallhaven',
  Extends: WallpaperProvider.Provider,
  wallpapers: [],

  _init: function () {
    this.parent();
    this.settings = Utils.getSettings(this);
    this.session = new Soup.Session();
    this.page = 0;
    this.dir = Utils.makeDirectory(Self.path + "/" + this.__name__);
    this.wallpapers = Utils.getFolderWallpapers(this.dir);
    this.settings.connect('changed', Lang.bind(this, this._applySettings));
    this._applySettings();
  },

  next: function (callback) {
    const newWallpaper = Lang.bind(this, function () {
      this._deleteWallpaper(this.currentWallpaper);
      this.currentWallpaper = this.wallpapers.shift();
      callback(this.currentWallpaper);
    });
	  //global.log(this.currentWallpaper);
	  //global.log("zypang :wallpaper length:"+this.wallpapers.length);

    if (this.wallpapers.length === 0) {
      let called = false;
      this._downloadPage(++this.page, Lang.bind(this, function (path) {
        this.wallpapers.push(path);
        if (!called) {
          called = true;
          newWallpaper()
        }
      }, Lang.bind(this, function () {
        if (this.page > 1) {
          this.page = 0;
          this.next(callback);
        }
      })));
    } else {
      newWallpaper()
    }
  },

  getPreferences: function () {
    const prefs = this.parent();

    this.settings.bind('query', prefs.get_object('field_query'), 'text', Gio.SettingsBindFlags.DEFAULT);

    this.settings.bind('category-general', prefs.get_object('field_general'), 'active', Gio.SettingsBindFlags.DEFAULT);
    this.settings.bind('category-anime', prefs.get_object('field_anime'), 'active', Gio.SettingsBindFlags.DEFAULT);
    this.settings.bind('category-people', prefs.get_object('field_people'), 'active', Gio.SettingsBindFlags.DEFAULT);

    this.settings.bind('purity-sfw', prefs.get_object('field_sfw'), 'active', Gio.SettingsBindFlags.DEFAULT);
    this.settings.bind('purity-sketchy', prefs.get_object('field_sketchy'), 'active', Gio.SettingsBindFlags.DEFAULT);
    this.settings.bind('purity-nsfw', prefs.get_object('field_nsfw'), 'active', Gio.SettingsBindFlags.DEFAULT);

    this.settings.bind('resolution', prefs.get_object('field_resolution'), 'active-id', Gio.SettingsBindFlags.DEFAULT);
    this.settings.bind('ratio', prefs.get_object('field_ratio'), 'active-id', Gio.SettingsBindFlags.DEFAULT);
    this.settings.bind('sorting', prefs.get_object('field_sorting'), 'active-id', Gio.SettingsBindFlags.DEFAULT);
    this.settings.bind('order', prefs.get_object('field_order'), 'active-id', Gio.SettingsBindFlags.DEFAULT);

    return prefs;
  },

  destroy: function () {
    this.session.abort();
  },

  _applySettings: function () {
    if (this.settingsTimer) {
      GLib.Source.remove(this.settingsTimer);
    }
    this.settingsTimer = null;

    OPTIONS.query = this.settings.get_string('query');

    OPTIONS.categories = (this.settings.get_boolean('category-general') ? '1' : '0')
      + (this.settings.get_boolean('category-anime') ? '1' : '0')
      + (this.settings.get_boolean('category-people') ? '1' : '0');

    OPTIONS.purity = (this.settings.get_boolean('purity-sfw') ? '1' : '0')
      + (this.settings.get_boolean('purity-sketchy') ? '1' : '0')
      + (this.settings.get_boolean('purity-nsfw') ? '1' : '0');

    OPTIONS.resolution = this.settings.get_string('resolution');
    OPTIONS.ratio = this.settings.get_string('ratio');
    OPTIONS.sorting = this.settings.get_string('sorting');
    OPTIONS.order = this.settings.get_string('order');

    /*this.settingsTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
      10,
      Lang.bind(this, function () {
        this._resetWallpapers();
        return false;
      })
    );*/
  },

  _resetWallpapers: function () {
    this.page = 0;
    let path;
    while (path = this.wallpapers.shift()) {
      this._deleteWallpaper(path);
    }
    this.emit('wallpapers-changed', this);
  },

  _deleteWallpaper: function (wallpaper) {
    if (wallpaper) {
      Gio.File.new_for_path(wallpaper).delete_async(GLib.PRIORITY_DEFAULT, null,
        function (file, res) {
          try {
            file.delete_finish(res);
          } catch (e) {
          }
        });
    }
  },

  _downloadPage: function (page, callback, no_match_callback) {
	const url='https://wallhaven.cc/search?' + OPTIONS.toParameterString() + '&page=' + page;
    global.log('_downloadPage url: ' + url);
    const request = this.session.request_http('GET',url);
    const message = request.get_message();
    this.session.queue_message(message, Lang.bind(this, function (session, message) {
      if (message.status_code != Soup.KnownStatusCode.OK) {
        global.log('_downloadPage error: ' + message.status_code);
        return;
      }

      const matches = message.response_body.data.match(/data-wallpaper-id="(\w+)"/g);
      if (matches) {
        /*const ids = matches.map(function (elem) {
          return elem.match(/\w+/);
        });*/
        matches.forEach(Lang.bind(this, function (match) {
			//global.log(match.substr(19,6));
          this._downloadWallpaper(match.substr(19,6), callback);
        }));
      } else {
		  global.log('no matches');
        if (no_match_callback) {
          no_match_callback(page);
        }
      }
    }));
  },

  _downloadWallpaper: function (id, callback) {
    this._requestWallpaperType(id, Lang.bind(this, function (type) {
		//global.log(type)
      const request = this.session.request_http('GET', 'https://w.wallhaven.cc/full/'+id.substr(0,2)+'/wallhaven-' + id + '.' + type);
      const message = request.get_message();

      const outputFile = this.dir.get_child('wallhaven-' + id + '.' + type);
      if (!outputFile.query_exists(null)) {
        const outputStream = outputFile.create(Gio.FileCreateFlags.NONE, null);

        this.session.queue_message(message, function (session, message) {
          const contents = message.response_body.flatten().get_as_bytes();
          outputStream.write_bytes(contents, null);
          outputStream.close(null);
          callback(outputFile.get_parse_name());
        });
      }
    }));
  },
  /*saveCurrentWallpaper: function(){
		global.log("zypang: currentwallpaper");
		global.log(this.currentWallpaper);
	if(this.currentWallpaper) {
		var sourceGFile=Gio.File.new_for_path(this.currentWallpaper);
		global.log("zypang: ");
		global.log(Gio.File.get_basename(sourceGFile));
		var destGFile=Gio.File.new_for_path('/home/zypang/SelectedWallpapers/'+Gio.File.get_basename(sourceGFile));
	}
  },*/
  _requestWallpaperType: function (id, callback) {
    const request = this.session.request_http('GET', 'https://wallhaven.cc/w/' + id);
    const message = request.get_message();
    this.session.queue_message(message, function (session, message) {
      if (message.status_code != Soup.KnownStatusCode.OK) {
        global.log('_requestWallpaperData error: ' + message.status_code);
        return;
      }

      const type = message.response_body.data.match(/\/\/w.wallhaven.cc\/full\/\w+\/wallhaven-\w+.(\w+)/i)[1];
      if (callback) {
        callback(type);
      }
    });
  }
});
