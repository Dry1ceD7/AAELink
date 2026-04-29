"use strict";

const { Menu } = require("electron");

/**
 * Application menu (Slack-style: View reload, window roles). Platform-specific root labels.
 * @param {{ isDarwin: boolean }} opts
 */
function setApplicationMenu(opts) {
  const { isDarwin } = opts;
  if (isDarwin) {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu", submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] },
        {
          label: "View",
          submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "togglefullscreen" }],
        },
        { role: "windowMenu" },
      ])
    );
  } else {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "AAELink",
          submenu: [{ role: "quit" }],
        },
        {
          label: "View",
          submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "togglefullscreen" }],
        },
        { role: "windowMenu" },
      ])
    );
  }
}

module.exports = { setApplicationMenu };
