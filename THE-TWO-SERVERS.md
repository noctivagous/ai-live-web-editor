
TWO SERVERS:

:4112 - The code editor (IDE),  agent, filesystem, UI, chat, pool. Run as built or live.
:5173 - The current code project being worked on. (live program / app), live with Vite npm run dev
        When each project (file) is loaded, it launches a server for it and loads it
        as an iframe in :4112's preview pane

    Two ways the editor reaches the live page:
      - default: page bridge via the Vite plugin - the project's own Vite cooperates:
            it injects the bridge, overlay, and chat, and answers the agent's page ops.
            Works in your own browser, no second browser to launch.
    - Playwright pool: the editor drives its own Chromium directly - no project
            cooperation needed, plus access to browser-level signals (console, network, debugger).
            Means launching a second browser.
          
  


Their server serves their app. :5173 is the edited project's own Vite — its framework, its plugins, its npm run dev flags,
  its HMR behavior. The launcher spawns that script as-is and never reimplements it. If the editor served the app
  itself, it would have to replicate every project's build setup — custom Vite plugins, non-Vite frameworks, HTTPS,
  backend sidecars — and any divergence means you're live-editing something that isn't quite their app.

  Our server serves the editor. :4112 is the agent brain, the filesystem, the UI, the chat, the pool. It switches
  projects, restarts dev servers, and persists state. None of that belongs in the app's server.

  A Vite plugin was made as the consent bridge between them. Injection, source stamps, and the page bridge all ride on the
  project's own server opting in. That's what makes pool-vs-plugin behave the same: the pool bypasses the question by
  driving its own Chromium; the plugin answers it by cooperation.

  And from where the user sits, it's already unified: the :5173 page renders inside the :4112 preview pane. One
  visible surface, two processes behind it — which is the right division. Keep the split; guarantee the bridge (that's
  the auto-ensure work), and the editor has the wide access you're describing without owning anyone's server.
  
  The pool is the editor's own Chromium, driven directly through Playwright — the path that needs nothing from the
  project. Paste-ready block in your file's voice:


    POOL (Playwright):

    The editor's own browser: a headed Chromium with a persistent profile kept
    inside the project folder (.chrome-data). Used when live work must not
    depend on the project's server cooperating. Enable it in Settings (or
    PLAYWRIGHT_POOL=1); LIVE_TARGET=pool routes the agent's page tools there.

    What it gives that the plugin path cannot:
      - works on any page with zero project setup (no plugin line needed),
      - any origin, not just the project's Vite (pass a url),
      - browser-level signals: console, page errors, failed requests, bad
        responses - captured per page and readable by the agent,
      - a visible window: the agent's tabs plus a /pool landing page showing
        pool state and recent agent activity.

    What it costs: a second browser process, browser binaries to install,
    and a profile directory on disk. The plugin path stays the default
    because it works inside your own browser with nothing extra to launch.

  One line to place above it, tying it to your existing "two ways" section: the pool is the how behind "drives its own
  Chromium" — worth stating that the pool browser is ordinary Chrome-for-Testing/the Playwright bundle, headed, so a
  human can watch exactly what the agent sees.