// PlatformProject class, to be inherited by platform specific classes
// like AndroidProject of BrowserProject

/* jshint unused:false, quotmark:false, sub:true */


/*

Intended interface:
A single class PlatformProject to be extended (or mixed into) by classes like AndroidProject
Primitive methods of the class:

All (most?) methods (but not the constructor) return promises.

open(root)  // open an existing project from the file system at given location
init(projInfo)   // init a new project given a bunch of input params, mosta imporatntly root dir
addPlugins(plugins)  // plugins = Array of PluginInfo objects
updateConfig(cfg?)   // update project config with things from ConfitParser
copyWww()
build() / run() / emulate()  // Proxies to equivalent scripts from the platform templates
wwwDir  // location for the www dir relative to project root if user wants to copy www himself

## Convenience functions (just ideas of what can be useful but not too magical)
addPluginsFrom(pluginDirs)  // Add all plugins found in any of the give dirs (using searchpath logic)
create(prjInfo) = init + addPlugins + updateConfig + copyWww
?updateAndRun() = copyWww + build  + run

*/


var Q = require('q');
var path = require('path');
var fs = require('fs');
// var semver = require('semver');
// var unorm = require('unorm');
var shell = require('shelljs');
// var et = require('elementtree');
var __ = require('lodash');


var cdv = {};

// cordova-lib imports
cdv.lib = require('cordova-lib');
cdv.superspawn = require('../node_modules/cordova-lib/src/cordova/superspawn');
cdv.PluginInfoProvider = require('../node_modules/cordova-lib/src/PluginInfoProvider');
cdv.ConfigKeeper = require('../node_modules/cordova-lib/src/plugman/util/ConfigKeeper');
cdv.config_changes  = require('../node_modules/cordova-lib/src/plugman/util/config-changes');
cdv.mungeutil = require('../node_modules/cordova-lib/src/plugman/util/munge-util');
cdv.common = require('../node_modules/cordova-lib/src/plugman/platforms/common');
cdv.mergeXml = require('../node_modules/cordova-lib/src/cordova/prepare')._mergeXml;

// Aliases
cdv.platforms = cdv.lib.cordova_platforms;
cdv.ConfigParser  = cdv.lib.configparser;
cdv.events = cdv.lib.events;

// Legacy logging
cdv.events.on('log', console.log);
cdv.events.on('error', console.error);
cdv.events.on('warn', console.warn);
cdv.events.on('verbose', console.log);


function PlatformProject(platform) {
    // Should probably be empty
}


PlatformProject.prototype.open = open;
function open(platform, root) {
    var self = checkThis(this);
    var rootDir = root || self.root;

    // Add all the platform specific code.
    // This overrides any methods that are also defined in prototype or the constructor.
    cdv.platforms.PlatformProjectAdapter.call(self, platform, rootDir);


    self.jsModuleObjects = [];
    self.installedPlugins = [];  // TODO: load this from persisted info, if any.
    return Q();
}

PlatformProject.prototype.init = init;
function init(opts) {
    var self = checkThis(this);

    var platformTemplateDir = opts.paths.template;
    var cfg = self.cfg = opts.cfg;


    self.root = opts.paths.root;
    opts = opts || {};
    var copts = { stdio: 'inherit' };

    // TODO, make normal logging, be able to accept different loggers
    // currently not plumbed well, no logger in open().
    var logger = opts.logger || console;
    self.logger = logger;

    var bin = path.join(platformTemplateDir, 'bin', 'create');


    var pkg = cfg.packageName().replace(/[^\w.]/g,'_');
    var name = cfg.name(); // CB-6992 it is necessary to normalize characters to NFD on iOS
    var args = [self.root, pkg, name];

    if (opts.link) {
        args.push('--link');
    }

    // Sync version, use superspawn for Async.
    // shell.exec([bin].concat(args).join(' '));

    // Async version
    return Q().then(function() {
        return cdv.superspawn.spawn(bin, args, copts);
    }).then(function() {
        return self.open(self.platform, self.root);
    }).then(function() {
        // TMP: Copy the default config.xml
        // It should just sit at parser.config_xml() from the beginning
        // Either savepoints or smart enough merging should take care of it all
        var defaultRuntimeConfigFile = path.join(self.root, 'cordova', 'defaults.xml');
        shell.cp('-f', defaultRuntimeConfigFile, self.config_xml());

        // TMP: Create plutform_www, should either exist in platform template
        // or however it should be done with browserify.
        var platform_www = path.join(self.root, 'platform_www');
        shell.mkdir('-p', platform_www);
        shell.cp('-f', path.join(self.www_dir(), 'cordova.js'), path.join(platform_www, 'cordova.js'));
    });
}


// Convenience variant of addPlugins that takes a list of dirs to load all plugins from
PlatformProject.prototype.addPluginsFrom = addPluginsFrom;
function addPluginsFrom(pluginDirs, opts) {
    var self = checkThis(this);
    opts = opts || {};
    var plugins = self.loadPlugins(pluginDirs, opts);
    return self.addPlugins(plugins, opts);
}

PlatformProject.prototype.addPlugins = addPlugins;
function addPlugins(plugins, opts) {
    var self = checkThis(this);
    opts = opts || {};

    // Install plugins into this platform project
    // NEXT2: check some constraints (dependencies, compatibility to target platfor(s))
    // NEXT1: validate variables are ok for all plugins (should be done per platform)
    // NEXT2: Check <engine> tags against platform version(s)

    // NEXT1: hooks before_plugin_install (context is the project object)

    // Handle install for all the files / assets

    var project_files;
    if (self.parseProjectFile) {
        project_files = self.parseProjectFile(self.root);
    }

    var tmpPrj= {plugins_dir: path.join(self.root, self.cfg.name(), 'Plugins')};


    plugins.forEach(function(p) {
        var assetFiles = p.getAssets(self.platform);
        var pluginItems = p.getFilesAndFrameworks(self.platform);

        pluginItems.forEach(function(item) {
            var installer = self.getInstaller(item.itemType);
            installer(item, p.dir, self.root, p.id, {}, project_files);
        });

        // This was originally part of prepare
        // Need to either redo on each prepare, or put in a staging www dir
        // that will be later copied into the real www dir on each prepare / www update.
        assetFiles.forEach(function(item) {
            common.asset.install(item, p.dir, self.www_dir()); // use plugins_wwww for this
        });

        // Save/update metadata in project
        self.installedPlugins.push(p);

        // Do js magic for plugins (part of prepare)
        var jsModules = p.getJsModules(self.platform);
        jsModules.forEach(function(jsModule) {
            // addJsModule(jsModule)
            self._copyJsModule(jsModule, p);
        });
    });

    self._savePluginsList();  // this one should also go into plugins_www

    // ## Do config magic for plugins
    // config-changes.PlatformMunger does a lot of things that are too smart
    // It caches and writes its own files (via ConfigKeeper)
    // Keeps track of how many plugins wanted the same change and deals with uninstallation
    // Shorten it
    // Move some of the logic into platforms - the plist stuff and windows manifests stuff
    var munge = {files:{}};
    var munger = new cdv.config_changes.PlatformMunger(self.platform, self.root, '', {save:__.noop}, self.pluginProvider); //
    plugins.forEach(function(p){
        var plugin_munge = munger.generate_plugin_config_munge(p.dir, p.vars);  // TODO: vars is not part of PluginInfo, make sure we get is from somewhere
        cdv.mungeutil.increment_munge(munge, plugin_munge);
    });

    // Apply the munge
    for (var file in munge.files) {
        munger.apply_file_munge(file, munge.files[file]); // Should be overrideable by the platform, generic apply_xml_munge, for ios either framework of xml.
    }

    munger.save_all();

    // Save a copy of parser.config_xml() at this point. With all changes from plugins, but no changes merged from project config.

    // TODO: Solve the plugin development case where a single plugin needs to be removed and reinstalled quickly.

    // NEXT2: display plugin info (maybe not, might be better done by user tool)
    // NEXT1: hooks after_plugin_install

    return Q();

}

PlatformProject.prototype.updateConfig = updateConfig;
function updateConfig() {
    var self = checkThis(this);
    var cfg = self.cfg;

    var platform_cfg = new cdv.ConfigParser(self.config_xml());
    cdv.mergeXml(cfg.doc.getroot(), platform_cfg.doc.getroot(), self.platform, true);
    platform_cfg.write();

    // Update all the project files
    self.update_from_config(cfg);
    return Q();
}

PlatformProject.prototype.copyWww = copyWww;
function copyWww(wwwSrc) {
    var self = checkThis(this);
    //  - Copy / update web files (including from plugins? or cache the plugins part of this somewhere)
    //    parser.update_www(); // nukes www, must be changed or called before anything else that writes to www. use plugins_www
    shell.cp('-rf', path.join(wwwSrc, '*'), self.www_dir());
    // Copy over stock platform www assets (cordova.js)
    shell.cp('-rf', path.join(self.root, 'platform_www', '*'), self.www_dir());
    return Q();
}

PlatformProject.prototype.save = save;
function save() {
    // Sync/serialize project info to a file in wofs (if needed, for plugin rm and reapplying plugin munges etc maybe)
    // wofs.write() if we are using RAM cached fs.
}

PlatformProject.prototype.build = build;
function build(opts) {
    var self = checkThis(this);
    var bin = path.join(self.root, 'cordova', 'build');
    var args = [];

    var copts = { stdio: 'inherit' };
    return cdv.superspawn.spawn(bin, args, copts);
}

PlatformProject.prototype.run = run;
function run(opts) {
    var self = checkThis(this);
    var bin = path.join(self.root, 'cordova', 'run');
    // shell.exec(bin);
    // return Q();
    var args = [];
    var copts = { stdio: 'inherit' };
    return cdv.superspawn.spawn(bin, args, copts);
}

PlatformProject.prototype.emulate = emulate;
function emulate(opts) {
    var self = checkThis(this);
    var bin = path.join(self.root, 'cordova', 'run');
    var args = ['--emulte'];
    var copts = { stdio: 'inherit' };
    return cdv.superspawn.spawn(bin, args, copts);
}

// create does everything needed before build/run
PlatformProject.prototype.create = create;
function create(prjInfo) {
    var self = checkThis(this);

    self.platform = prjInfo.platform;

    // A very ugly hack to make icons and splash screens work
    // <icon src="?"> refers to paths relative to the traditional
    // root of cordova project. Spoof it here with whatever path is
    // provided as taht root.
    if (prjInfo.paths.icons) {
        var cdvutil = require('../node_modules/cordova-lib/src/cordova/util');
        cdvutil.isCordova = function(d) {
            return prjInfo.paths.icons;
        };
    }

    return Q().then(function(){
        return self.init(prjInfo);
    }).then(function(){
        return self.addPluginsFrom(prjInfo.paths.plugins);
    }).then(function(){
        return self.updateConfig();
    }).then(function(){
        return self.copyWww(prjInfo.paths.www);
    });
}


/*
PlatformProject.prototype.funcName = funcName;
function funcName(plugins, opts) {

}
*/


// ################# Public convenience functions
// Should loadPlugins be a method of the PlatformProject? Maybe move it into PluginInfoProvider.
PlatformProject.prototype.loadPlugins = loadPlugins;
function loadPlugins(pluginDirs, opts) {
    var self = checkThis(this);
    if (!__.isArray(pluginDirs)) {
        pluginDirs = [pluginDirs];
    }

    if (!self.pluginProvider)
        self.pluginProvider = new cdv.PluginInfoProvider();

    var plugins = pluginDirs.map(function(d) {
        return self.pluginProvider.getAllWithinSearchPath(d);
    });
    plugins = __.flatten(plugins);

    // Load test plugins, if requested.
    if (opts.addtests) {
        var testPlugins = [];
        plugins.forEach(function(p){
            var testsDir = path.join(p.dir, 'tests');
            if (fs.existsSync(testsDir)) {  // Maybe should check for existence of plugin.xml file.
                var tp = self.pluginProvider.get(testsDir);
                testPlugins.push(tp);
            }

        });
        plugins = plugins.concat(testPlugins);
    }

    return plugins;
}


// ###### Kinda private functions

// copied from plugman/prepare.js - old way, not browserify, needs refactoring via self.fs
PlatformProject.prototype._copyJsModule = _copyJsModule;
function _copyJsModule(module, pluginInfo) {
    var self = checkThis(this);
    var platformPluginsDir = path.join(self.www_dir(), 'plugins');
    // Copy the plugin's files into the www directory.
    // NB: We can't always use path.* functions here, because they will use platform slashes.
    // But the path in the plugin.xml and in the cordova_plugins.js should be always forward slashes.
    var pathParts = module.src.split('/');

    var fsDirname = path.join.apply(path, pathParts.slice(0, -1));
    var fsDir = path.join(platformPluginsDir, pluginInfo.id, fsDirname);
    shell.mkdir('-p', fsDir);

    // Read in the file, prepend the cordova.define, and write it back out.
    var moduleName = pluginInfo.id + '.';
    if (module.name) {
        moduleName += module.name;
    } else {
        var result = module.src.match(/([^\/]+)\.js/);
        moduleName += result[1];
    }

    var fsPath = path.join.apply(path, pathParts);
    var scriptContent = fs.readFileSync(path.join(pluginInfo.dir, fsPath), 'utf-8').replace(/^\ufeff/, ''); // Window BOM
    if (fsPath.match(/.*\.json$/)) {
        scriptContent = 'module.exports = ' + scriptContent;
    }
    scriptContent = 'cordova.define("' + moduleName + '", function(require, exports, module) { ' + scriptContent + '\n});\n';
    fs.writeFileSync(path.join(platformPluginsDir, pluginInfo.id, fsPath), scriptContent, 'utf-8');

    // Prepare the object for cordova_plugins.json.
    var obj = {
        file: ['plugins', pluginInfo.id, module.src].join('/'),
        id: moduleName
    };
    if (module.clobbers.length > 0) {
        obj.clobbers = module.clobbers.map(function(o) { return o.target; });
    }
    if (module.merges.length > 0) {
        obj.merges = module.merges.map(function(o) { return o.target; });
    }
    if (module.runs) {
        obj.runs = true;
    }

    // Add it to the list of module objects bound for cordova_plugins.json
    self.jsModuleObjects.push(obj);
}

PlatformProject.prototype._savePluginsList = _savePluginsList;
function _savePluginsList() {
    var self = checkThis(this);
    // Write out moduleObjects as JSON wrapped in a cordova module to cordova_plugins.js
    var final_contents = "cordova.define('cordova/plugin_list', function(require, exports, module) {\n";
    final_contents += 'module.exports = ' + JSON.stringify(self.jsModuleObjects,null,'    ') + ';\n';
    final_contents += 'module.exports.metadata = \n';
    final_contents += '// TOP OF METADATA\n';
    var pluginMetadata = {};
    self.installedPlugins.forEach(function (p) {
        pluginMetadata[p.id] = p.version;
    });
    final_contents += JSON.stringify(pluginMetadata, null, '    ') + '\n';
    final_contents += '// BOTTOM OF METADATA\n';
    final_contents += '});'; // Close cordova.define.

    cdv.events.emit('verbose', 'Writing out cordova_plugins.js...');
    fs.writeFileSync(path.join(self.www_dir(), 'cordova_plugins.js'), final_contents, 'utf-8');
}

function checkThis(t) {
    if (!(t instanceof PlatformProject)) {
        throw new Error('Function not bound properly to `this`.');
    }
    return t;
}


exports.cdv = cdv;
exports.PlatformProject = PlatformProject;
