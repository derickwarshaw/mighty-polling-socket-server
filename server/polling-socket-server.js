const express = require('express');
const expressWs = require('express-ws');

const { Observable } = require('./rxjs');

const { IntervalManager } = require('./interval-manager');
const { SessionManager } = require('./session-manager');
const { PollManager } = require('./poll-manager');
const { SocketMonitor } = require('./socket-monitor');
const { SocketLogger } = require('./socket-logger');

/**
 * Core class for instantiating a new server.
 * 
 * @class PollingSocketServer
 * @param {object} [params] Optional configuration parameters 
 * @param {number} [params.defaultInterval=2000] Global time interval if none supplied
 * @param {boolean} [params.checkHeartbeat=false] Enable periodic checks for dropped connections
 * @param {object} [params.expressApp] Bring your own `express()` app with routes configured
 * @param {object} [params.requestOptions] Default options for every http request
 * @param {object} [params.wsOptions] Options to pass into `ws` socket server
 */
class PollingSocketServer {
  constructor({
    defaultInterval = 2000,
    checkHeartbeat = false,
    expressApp = express(),
    requestOptions,
    sessionStore,
    wsOptions,
    logging = true,
    stats = false
  } = {}) {
    /**
     * Save some options to parameter map.
     */
    this._params = { defaultInterval, requestOptions, sessionStore, wsOptions, stats };

    /**
     * Creates an `express` app, mounts the express app
     * onto an `express-ws` instance, and saves a reference
     * to the socket server for later use.
     */
    this.app = expressApp;
    this.wss = expressWs(this.app, null, { wsOptions }).getWss();

    /**
     * Tracks all connection events (open and close) in a single
     * observable and reports number of connections.
     */
    this.connection$ = this._getConnections();

    /**
     * A "pauser" observable that emits when a connection is opened
     * or closed; emits true if there are no connections remaining
     * and false if so (if the emission is different from previous).
     */
    this.paused$ = this.connection$
      .map(() => this.wss.clients.size === 0)
      .distinctUntilChanged()
      .do(status => this.logger.log('interval', status ? 'idle' : 'active'))
      .share();

    /**
     * Instantiate and assign new instances of lower-level classes.
     */
    this.logger = new SocketLogger(logging);
    this.intervalManager = new IntervalManager(this.paused$, this.logger);
    this.sessionManager = new SessionManager(this.app, this._params, this.logger);
    this.pollManager = new PollManager(this.intervalManager, this._params, this.logger);

    /**
     * Add aliases to internal class properties for backwards
     * compatibility reasons.
     */
    this.interval$ = this.intervalManager.intervals;
    this.logger$ = this.logger.log$;

    /**
     * Enable periodic checks for dropped connections if enabled.
     */
    if (checkHeartbeat) {
      this._enableHeartbeatCheck();
    }
  }

  /**
   * Adds sources to the list of things to poll, i.e. instantiates polling
   * routes that clients can connect to. Each unique `source` sets up
   * a route for clients to connect to, which activates a poller and
   * subscribes/unsubscribes to its source feed when connected/disconnected.
   * 
   * @param {object[]} sources 
   * @memberof PollingSocketServer
   */
  sources(sources) {
    /**
     * Add the provided sources to the `PollManager`'s registry.
     */
    this.pollManager.addSources(sources);
    
    /**
     * Initializes an `express` app route for each source type.
     * Each route receives the type key as its route endpoint
     * and as a pointer to the correct `poller` and feed.
     */
    sources.forEach(({ type, path }) => {
      this.app.ws(`/${path || type}`, client => this.pollManager.openClientPoll(type, client));
      this.logger.log('server', `route enabled at /${path || type}`)
    });
  }

  /**
   * Activates socket server and Express app; listens on given port.
   * 
   * @param {number} [port=8080] The port to listen on
   * @memberof PollingSocketServer
   */
  broadcast(port = 8080) {
    /**
     * If `stats` is enabled, instantiate a `SocketMonitor` instance.
     */
    if (this._params.stats) {
      this._statMonitor = new SocketMonitor(this);
    }

    /**
     * Listen on the given port; report and handle errors.
     */
    return Observable.bindNodeCallback(this.app.listen)(port)
      .catch(error => this.logger.log('error', error))
      .subscribe(() => this.logger.log('server', `listening on port ${port}`));
  }

  /**
   * Returns an Observable that tracks all connection events
   * (open and close) in a single source and reports the number
   * of active connections when it changes.
   * 
   * @memberof PollingSocketServer
   */
  _getConnections() {
    /**
     * Emits incoming socket connections as they connect
     * and shares the connection with all its subscribers.
     */
    this.connectionOpened$ = Observable
      .fromEvent(this.wss, 'connection');

    /**
     * Takes an incoming socket connection and maps it to
     * an observable for the closing of that connection.
     */
    this.connectionClosed$ = this.connectionOpened$
      .flatMap(ws => Observable.fromEvent(ws, 'close'))
      .mapTo(false);

    /**
     * Emits a connection event for each new connection,
     * and `false` when a connection has closed.
     */
    return Observable
      .merge(this.connectionOpened$, this.connectionClosed$)
      .do(state => this.logger.log('websocket', `client ${state ? '' : 'dis'}connected, pool: ${this.wss.clients.size}`))
      .share();
  }

  /**
   * Sets up the optional "heartbeat check", which subscribes to
   * new connections' `pong` events to periodically check that the
   * connection wasn't dropped in tandem with a 30 second interval.
   * 
   * @memberof PollingSocketServer
   */
  _enableHeartbeatCheck() {
    const { logger } = this;
    function heartbeat() {
      this.isAlive = true;
      logger.log('heartbeat', 'pong');
    };
    this.intervalManager.getInterval(20000)
      .do(() => this.wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping('', false, true);
        this.logger.log('heartbeat', 'ping');
      })).subscribe();
    this.connectionOpened$
      .subscribe(ws => {
        ws.isAlive = true;
        ws.on('pong', heartbeat);
      });
  }
}

exports.PollingSocketServer = PollingSocketServer;