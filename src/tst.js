#!/usr/bin/env node

/* jshint unused: false */

var pp = require('./PlatformProject');

var shell = require('shelljs');
var path = require('path');

var cordovaLib = require('cordova-lib');

var ConfigParser  = cordovaLib.configparser;
var __ = require('lodash');


var projDir = '/tmp/cdvtest';
var configXml = '/Users/kamrik/src/coreproj/app/config.xml';
var wwwDir = '/Users/kamrik/src/coreproj/app/www';
var nodeModulesDir = '/Users/kamrik/src/coreproj/node_modules';
var platformTemplateDir = path.join(nodeModulesDir, 'cordova-ios');


var cfg = new ConfigParser(configXml);

// Declarative info about the project
// this one should be discussed and standardized
var prjInfo = {
	platform: 'ios',
    paths: {
        www: wwwDir,
        icons: path.dirname(wwwDir),
        root: projDir,
        template: platformTemplateDir,
        plugins: [nodeModulesDir],
    },
    cfg: cfg,
};

// Nuke the old dir entirely
shell.rm('-rf', projDir);

var proj = new pp.PlatformProject();

// Experimenting with ways to mind methods to objects
__.bindAll(proj, 'build', 'run');

proj.create(prjInfo)
    //.then(proj.run)  // assumes build is well bound to proj
    .done();

// proj.open(projDir)
//     .then(proj.run)
//     .done();

