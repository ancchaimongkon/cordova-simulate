// Copyright (c) Microsoft Corporation. All rights reserved.

/*
 * This module implements communication protocol as described
 */

var log = require('./log'),
    config = require('./config'),
    livereload = require('./live-reload/live-reload-server'),
    telemetry = require('./telemetry-helper'),
    q = require('q');

// make variable match the literal
var APP_HOST = 'APP_HOST',
    SIM_HOST = 'SIM_HOST';

var hostSockets = {};

var pendingEmits = {};
pendingEmits[APP_HOST] = [];
pendingEmits[SIM_HOST] = [];

var whenAppHostConnected = q.defer(),
    whenSimHostReady     = q.defer();

function setupAppHostHandlers() {
    var socket = hostSockets[APP_HOST];
    log.log('Setup handlers for APP_HOST');

    socket.on('exec', function (data) {
        emitToHost(SIM_HOST, 'exec', data);
    });

    socket.on('plugin-message', function (data) {
        emitToHost(SIM_HOST, 'plugin-message', data);
    });

    socket.on('plugin-method', function (data, callback) {
        emitToHost(SIM_HOST, 'plugin-method', data, callback);
    });

    socket.on('telemetry', function (data) {
        telemetry.handleClientTelemetry(data);
    });

    // Set up live reload if necessary.
    if (config.liveReload) {
        log.log('Starting live reload.');
        livereload.init(socket);
    }

    // Set up telemetry if necessary.
    if (config.telemetry) {
        socket.emit('init-telemetry');
    }
    
    // Set up xhr proxy
    if (config.xhrProxy) {
        socket.emit('init-xhr-proxy');
    }

    handlePendingEmits(APP_HOST);
}

function handleSimHostRegistration(socket) {
    socket.once('ready', handleSimHostReady);
    emitToHost(SIM_HOST, 'init');
}

function onAppHostConnected() {
    var socket = hostSockets.APP_HOST;
    socket.once('app-plugin-list', handleAppPluginList);

    emitToHost(APP_HOST, 'init');
}

function onSimHostReady() {
    setupAppHostHandlers();
}

function handleSimHostReady() {
    // resolving this promise will result in app-host handlers setupp
    whenSimHostReady.resolve();

    setupSimHostHandlers();

    whenAppHostConnected.promise
        .then(onAppHostConnected);
}

function handleAppPluginList(data) {
    var socket = hostSockets.SIM_HOST;

    socket.once('start', handleStart);

    emitToHost(SIM_HOST, 'app-plugin-list', data);
}

function handleStart() {
    emitToHost(APP_HOST, 'start');
}

function setupSimHostHandlers() {
    log.log('Setup handlers for SIM_HOST');

    var socket = hostSockets.SIM_HOST;

    socket.on('exec-success', function (data) {
        emitToHost(APP_HOST, 'exec-success', data);
    });
    socket.on('exec-failure', function (data) {
        emitToHost(APP_HOST, 'exec-failure', data);
    });

    socket.on('plugin-message', function (data) {
        emitToHost(APP_HOST, 'plugin-message', data);
    });

    socket.on('plugin-method', function (data, callback) {
        emitToHost(APP_HOST, 'plugin-method', data, callback);
    });

    socket.on('telemetry', function (data) {
        telemetry.handleClientTelemetry(data);
    });

    // Set up telemetry if necessary.
    if (config.telemetry) {
        socket.emit('init-telemetry');
    }

    handlePendingEmits(SIM_HOST);

}

function init(server) {
    var io = require('socket.io')(server);

    io.on('connection', function (socket) {
        socket.on('register-app-host', function () {
            log.log('APP_HOST connected to the server');
            hostSockets[APP_HOST] = socket;
            whenSimHostReady.promise
                .then(onSimHostReady);
            whenAppHostConnected.resolve();
        });

        socket.on('register-simulation-host', function () {
            log.log('SIM_HOST connected to the server');
            hostSockets[SIM_HOST] = socket;
            handleSimHostRegistration(socket);
        });

        socket.on('disconnect', function () {
            var type;
            Object.keys(hostSockets).forEach(function (t) {
                if (hostSockets[t] === socket) {
                    type = t;
                }
            });
            hostSockets[type] = undefined;
            log.log(type + ' disconnected to the server');
            switch (type) {
                case APP_HOST:
                    whenAppHostConnected = q.defer();
                    whenAppHostConnected.promise.then(onAppHostConnected);
                    break;
                case SIM_HOST:
                    whenSimHostReady = q.defer();
                    whenSimHostReady.promise.then(onSimHostReady);
                    break;
                default:
                    throw new Error('Got a disconnect from an unknown socket');
                    break;
            }

        });

    });
}

function handlePendingEmits(host) {
    log.log('Handling pending emits for ' + host);
    pendingEmits[host].forEach(function (pendingEmit) {
        emitToHost(host, pendingEmit.msg, pendingEmit.data, pendingEmit.callback);
    });
    pendingEmits[host] = [];
}

function emitToHost(host, msg, data, callback) {
    var socket = hostSockets[host];
    if (socket) {
        log.log('Emitting \'' + msg + '\' to ' + host);
        socket.emit(msg, data, callback);
    } else {
        log.log('Emitting \'' + msg + '\' to ' + host + ' (pending connection)');
        pendingEmits[host].push({ msg: msg, data: data, callback: callback });
    }
}


function invalidateSimHost() {
    // Simulation host is being refreshed, so we'll wait on a new connection.
    hostSockets[SIM_HOST] = undefined;
}

module.exports.init = init;
module.exports.emitToHost = emitToHost;
module.exports.invalidateSimHost = invalidateSimHost;
