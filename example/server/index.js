const express = require('express');

const { PollingSocketServer } = require('../../server/polling-socket-server');

/**
 * Provide source endpoints (i.e. from a REST API or RSS feed) to poll.
 */
const SOURCE_LIST = [
  {
    type: 'rss-example',
    url: 'http://localhost:8080/rss.xml',
    compare: (
      { rss: { channel: [{ item: oldItem }] } },
      { rss: { channel: [{ item: newItem }] } },
    ) => {
      if (oldItem && oldItem.length) {
        if (!newItem || !newItem.length || newItem.length !== oldItem.length) {
          return false;
        }
        if (newItem && newItem.length) {
          const [{ pubDate: [oldLastDate] }] = oldItem;
          const [{ pubDate: [newLastDate] }] = newItem;
          return oldLastDate === newLastDate;
        }
      } else {
        return !(newItem && newItem.length);
      }
    },
    xml: true
  },
  {
    type: 'json-example',
    url: 'http://localhost:8080/json.json',
    compare: ([{ pubDate: last }], [{ pubDate: current }]) => last === current
  }
];

/**
 * Configure a new server instance with a default interval and heartbeat.
 */
const pss = new PollingSocketServer({
  defaultInterval: 2000,
  checkHeartbeat: true,
  stats: true
});

/**
 * Add middleware for serving static data examples from `data-examples`.
 */
const staticDataMiddleware = express.static('example/server/data-examples');
pss.app.use(staticDataMiddleware);

/**
 * Add sources to server websocket routes.
 */
pss.sources(SOURCE_LIST);

/**
 * Start server and listen for connections on port 8080.
 */
pss.broadcast(8080);
