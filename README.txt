TRADING JOURNAL
===============

HOW TO START
1. Unzip this folder anywhere on your PC.
2. Double-click  start-journal.bat
   (The first time it may install a few files. Wait until it finishes.)
3. Your browser opens the journal. Keep the black window open while you use it.
   Close the black window to stop the journal.

HOW TO ADD A TRADE
1. Press Win + Shift + S and take a screenshot of your chart.
2. Open "Add trade". Click the Before box (or the After box).
3. Press Ctrl + V. The screenshot is saved to your folder right away.
4. Fill in the trade and click Save trade.
Tip: you can save the trade with only the Before screenshot when you enter.
Later, open the trade, click "Close trade / edit", paste the After screenshot
and type the result.

HOW TO COPY A SCREENSHOT OUT
- Point at a screenshot with the mouse and press Ctrl + C, or click the Copy button.
- Then press Ctrl + V in your platform, Telegram, or anywhere.

WHERE YOUR FILES ARE
- Screenshots:  C:\Users\elles\Pictures\Screenshots\TradingJournal
  (change it in config.json, then start the journal again)
- Trade data:   the "data" folder inside this folder.
  To make a backup, copy the "data" folder and the screenshots folder,
  or use Settings > "Download a backup of my trades".

USING IT ON YOUR PHONE (same Wi-Fi)
1. Start the journal on your PC. The black window shows a line like
   "On your phone:  http://192.168.1.5:3000". Open that address on your phone.
2. The first time, Windows may ask to allow Node.js on your network.
   Click "Allow" for Private networks.
3. On the phone, use the "Add photo or file" button (gallery or camera).
4. The Copy button works on the PC. On the phone, over this normal address,
   the browser blocks copying, so the image opens instead. Press and hold the
   image to copy or save it.
5. Your PC must be on and the journal must be running.
Note: everyone has to log in. Each person only sees their own account (see ACCOUNTS below).

GROQ EDGE AI
----------------
- EDGE AI uses Groq through the Node.js server. The Groq API key is never sent to the browser.
- Set GROQ_API_KEY before starting the server. Example in PowerShell:
  $env:GROQ_API_KEY="your_key_here"
- Optional model: $env:GROQ_MODEL="openai/gpt-oss-20b"
- Then run: node server.js
- The AI can explain the site, analyze journal statistics, search trades, and trigger supported website actions.

NEW IN VERSION 2
- Draw on a screenshot: on the Add / Edit page, click "Draw" on a screenshot.
  Pick Pen, Line, Arrow, Box or Text, pick a colour, then draw. Click "Copy" to copy
  the marked picture, "Save as new image" to keep both, or "Replace original".
  Press Ctrl+Z to undo.
- Labels: type a label under each screenshot (example: "1H chart", "5M entry").
- Zoom: click a screenshot to open it big. Scroll to zoom, drag to move,
  double-click to reset.
- Compare: on a trade page, click "Compare before and after". Use "Side by side"
  (both pictures zoom together) or "Slider" (move a line over the pictures).
- My rules: write your own rules in Settings (one per line). Tick the ones you
  followed on every trade. The Stats page shows how following your rules changes
  your results. If you never touch the boxes, that trade is not counted.
- Close now: for a trade that is still open, click "Close now" in the Journal (or on
  the trade page). Paste the After screenshot, type the result, tick your rules, save.
- Start from an earlier trade: on the Add trade page, choose an earlier trade in
  "Start from an earlier trade", or click "Use as template" on any trade page.

HOW TO UPDATE FROM VERSION 1
Unzip the new files into the same folder and choose "Replace". Your trades
(the "data" folder) and your screenshots are not touched. If you changed
config.json, keep your own copy.

SETTINGS
Open the Settings page to set your starting balance, your pairs (and pip size),
and the hours when the Asia, London and New York sessions start.


PHASE 2 INTELLIGENCE

The Insights workspace analyzes recorded trades using only journal data.
It surfaces Trading DNA, behavior leaks, rule performance correlations,
execution scores, a session/setup pattern matrix, a research queue, and
plain language command search.

Patterns are only surfaced when enough recorded examples exist.
No external AI service or trading signal engine is used.

PHASE 4 LOCAL AI ASSISTANT

EDGE AI is free to use without an OpenAI API key. It runs through Ollama on the same PC as the journal.

FIRST TIME SETUP
1. Install Ollama for Windows.
2. Double-click setup-edge-ai.bat.
3. The setup downloads qwen2.5:3b once and starts the local Ollama service.
4. Start the journal with start-journal.bat.

PRIVACY
Your questions and journal context are sent to Ollama on localhost only. They are not sent to OpenAI or another paid AI API by EDGE.

MODEL
Default local model: qwen2.5:3b
You can change OLLAMA_MODEL in the environment or config.json.

REQUIREMENT
A local model uses your PC's CPU/RAM. Larger models may need more RAM and run slower. The 3B model is the default for a lighter setup.


ACCOUNTS AND LOGIN (VERSION 3.2)

- The first time you open the journal you create the first account. It becomes the admin
  and automatically takes over any trades, settings and screenshots that already exist.
- After that, other people open the same address, click "Create account" and get their own
  empty journal. Other users cannot see each other's trades, screenshots, settings, knowledge
  notes or EDGE AI answers. The admin can (see ADMIN AI ACCESS below), and the sign-up screen says so.
- Everything stays on this PC:
    Trade data:   data\users\<name>_<id>\
    Screenshots:  <imageDir>\<name>_<id>\
    Accounts:     data\users.json (passwords are stored as scrypt hashes, never as text)
  Your old files were kept in data\legacy-backup\ in case you ever need them.
- Backups: copy the data folder and the screenshots folder. "Download a backup" in Settings
  only backs up the account you are logged in to.
- Forgot a password: close the journal, double-click reset-password.bat, type the username and a
  new password, then start the journal again.
- Optional controls (config.json or environment variables):
    "allowSignup": false   or ALLOW_SIGNUP=false   -> no new accounts can be created
    INVITE_CODE=somecode                           -> people must enter this code to sign up
  Login sessions last 30 days. Changing your password logs out your other devices.
- Over plain http on your Wi-Fi, passwords are not encrypted in transit. That is fine at home,
  but for internet use put it behind https (the deploy folder does this) and set TRUST_PROXY=1.


ADMIN PANEL (VERSION 3.3)

Admins open it from the account menu (top right) > Admin panel. The first account is the admin.
- EDGE AI: turn it on or off for everyone (instantly), choose the model, paste or replace the
  Groq API key, set how many questions each person can ask per minute, how many trades are sent to
  the AI as context, and add extra instructions the AI follows for every user.
  "Test connection" checks the key and model before you save. A key saved here is stored on this
  PC in data\admin.json and overrides GROQ_API_KEY. It is never sent to anyone's browser.
- AI access per person: each account has its own AI switch, and you can see how many questions
  each person has asked.
- New accounts: open or close sign-ups and set an invite code.
- Accounts: make someone an admin or a regular user, disable or enable them (disabled people are
  logged out and cannot log in), reset their password, or delete them. Deleting never destroys
  files: the trades and screenshots are moved to data\deleted-users\ on this PC.
- You cannot disable, delete or demote yourself, and there is always at least one admin.
- Admin settings win over config.json and environment variables.


ADMIN AI ACCESS (VERSION 3.4)

- When an admin opens the EDGE AI panel, a "Looking at" picker appears: My journal, Everyone, or
  one person. EDGE AI then answers from that account's trades and stats.
- It is read-only: in those views EDGE AI never changes anything, and the save/add commands only
  run on your own journal.
- Regular users never get the picker. Their EDGE AI only sees their own journal, and the server
  refuses any attempt to ask about someone else.
- Each use is printed in the server log as "[AI] admin ... asked EDGE AI about ...".


ANALYSIS SECTION (VERSION 3.5)

- "Analysis" in the top menu is a place to save chart analysis screenshots, Before and After, with
  no trade attached. Click Before or After, then Ctrl+V (or drag a file, or use Add photo or file).
  The Draw tool and screenshot labels work the same as in Add trade.
- Add a pair, date, timeframe, bias (Bullish / Bearish / Neutral), a title, notes and tags. All of
  them are optional, but you need at least one screenshot or a note.
- Filter by pair or bias, search the notes and tags, click a screenshot to view it large, edit or
  delete. Deleting an analysis also deletes its screenshots.
- Each account has its own analyses (data\users\<name>_<id>\analyses.json, screenshots in the
  same screenshots folder as trades). EDGE AI can read your analysis notes too.
