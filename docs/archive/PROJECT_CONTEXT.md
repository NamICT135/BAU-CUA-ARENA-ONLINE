# Bau Cua Arena — Codex V2 Project Context & Study Guide

> **Project:** Bau Cua Arena – An Online Vietnamese Dice Game  
> **Course:** Web Application Development  
> **Goal:** Build a polished final project that maximizes syllabus coverage while avoiding unnecessary technologies that were not taught in class.

---

## 0. How to Use This File

This file is designed to be used in two ways:

1. **Give it to Codex as project context**
   - Codex should follow the technical boundaries, architecture, phases, and acceptance criteria in this file.
   - Codex should not introduce technologies outside the scope unless explicitly requested.

2. **Use it as your personal study guide**
   - Before presenting the project, study the “Knowledge to Learn” sections.
   - You should be able to explain the major HTML, CSS, JavaScript, Node.js, HTTP, npm, and Vite decisions in your own words.

The most important rule:

> **Prefer a smaller project that is correct, polished, and explainable over a large project with many features you cannot defend.**

---

# 1. Course Scope This Project Should Demonstrate

The uploaded course materials emphasize the following progression:

## 1.1 Introduction to Internet & WWW

You should understand:

- Internet vs Web
- Browser, web server, DNS
- Client–server model
- HTTP request / HTTP response
- HTML as the document language
- How a browser requests a resource and receives HTML/CSS/JavaScript
- Why `http://localhost/...` is different from opening a file with `file:///...`

### What this project demonstrates

```text
Browser
   |
   | HTTP request
   v
Vite development server
   |
   | /api proxy
   v
Node.js server
   |
   | JSON response
   v
Browser JavaScript updates the page
```

You should be able to answer:

- What is the client?
- What is the server?
- What does HTTP do?
- What is the difference between HTML and HTTP?
- Why does the browser use `fetch()`?
- Why does the Node.js server return JSON?

---

# 2. HTML Knowledge You Need

The course expects you to understand HTML structure, semantic meaning, and accessibility.

## 2.1 Basic HTML structure

Know:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Bau Cua Arena</title>
</head>
<body>
</body>
</html>
```

## 2.2 Semantic HTML

Prefer semantic elements when they describe the purpose of content:

```html
<header>
<nav>
<main>
<section>
<article>
<aside>
<footer>
```

Instead of using `<div>` for everything.

### Project usage

Suggested layout:

```html
<header>
    <nav>...</nav>
</header>

<main>
    <section id="hero">...</section>
    <section id="game">...</section>
    <section id="statistics">...</section>
    <section id="how-to-play">...</section>
</main>

<footer>...</footer>
```

## 2.3 Block vs inline

Know the difference between:

### Block-level examples

```html
<div>
<p>
<h1>
<section>
header>
nav>
main>
footer>
```

A block usually starts on a new line and occupies available width.

### Inline examples

```html
<span>
<a>
<strong>
<em>
<img>
```

They remain inside the current line.

## 2.4 Forms and buttons

Use real controls:

```html
<button type="button">SHAKE</button>
```

Do not create clickable game actions using only:

```html
<div onclick="...">
```

### Why

- keyboard accessibility
- semantic meaning
- built-in browser behaviour
- easier event handling

## 2.5 Accessibility basics

Know why the project should include:

- semantic elements
- logical heading order
- real buttons
- visible focus states
- readable contrast
- `alt` text for meaningful images
- `aria-live` for changing game results when appropriate

---

# 3. CSS Knowledge You Need

The course materials strongly emphasize understanding why CSS works, not only copying styles.

---

## 3.1 CSS selectors

Know:

```css
p { }
.note { }
#game { }
```

Meaning:

- tag selector
- class selector
- id selector

## 3.2 CSS specificity

General idea:

```text
inline style
    >
id selector
    >
class selector
    >
tag selector
```

If specificity is equal, the rule written later usually wins.

Avoid relying on:

```css
!important
```

unless absolutely unavoidable.

---

# 4. CSS Box Model

Every element contains:

```text
margin
  border
    padding
      content
```

Example:

```css
.card {
    width: 300px;
    padding: 15px;
    border: 5px solid black;
    margin: 10px;
}
```

Without `border-box`, the final drawn width is larger than `300px`.

Use this global rule:

```css
* {
    box-sizing: border-box;
}
```

Then the declared width includes padding and border.

### You should be able to explain

- What is content?
- What is padding?
- What is border?
- What is margin?
- Why does `box-sizing: border-box` simplify layouts?

---

# 5. Flexbox

Use Flexbox for **one-dimensional layout**.

Good project examples:

- navigation bar
- chip selection
- action button row
- result information
- header controls

Example:

```css
.controls {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
}
```

Know:

```css
display: flex;
gap:
justify-content:
align-items:
flex-wrap:
```

### Important

`display: flex` normally belongs to the **parent** whose children should be arranged.

---

# 6. CSS Grid

Use Grid for **two-dimensional layout**.

Perfect use in this project:

```text
Bầu | Cua | Tôm
---------------
Cá  | Gà  | Nai
```

Example:

```css
.game-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
}
```

For mobile:

```css
@media (max-width: 600px) {
    .game-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}
```

---

# 7. Responsive Design

The project must work on:

- desktop
- tablet
- mobile

Use:

```css
@media (...)
```

Requirements:

- no page-level horizontal scrolling
- buttons remain easy to press
- text stays readable
- game grid reorganizes properly
- controls wrap instead of overflowing
- history remains readable

You should be able to explain:

> A media query applies CSS only when a condition such as screen width is satisfied.

---

# 8. Pseudo-classes and Interaction Styling

Examples:

```css
button:hover { }
button:focus { }
button:active { }

.nav-link:hover { }
```

Use these to provide interaction feedback.

Do not communicate selection only through color.

For example:

```text
selected chip:
- color change
- border change
- text/label state
```

---

# 9. JavaScript Knowledge You Need

This is the core of the project.

---

## 9.1 `const` and `let`

Use:

```javascript
const symbols = [...];
```

when the variable reference does not need reassignment.

Use:

```javascript
let selectedChip = 10;
```

when the value changes later.

Rule:

> Use `const` by default, `let` only when reassignment is required.

---

# 10. Template Literals

Know:

```javascript
const message = `Balance: ${balance} coins`;
```

Instead of:

```javascript
const message = "Balance: " + balance + " coins";
```

---

# 11. Arrays

Example:

```javascript
const symbols = [
    "bau",
    "cua",
    "tom",
    "ca",
    "ga",
    "nai"
];
```

Project arrays may store:

- symbols
- chip values
- dice result
- game history

---

# 12. Objects

Example:

```javascript
let bets = {
    bau: 0,
    cua: 0,
    tom: 0,
    ca: 0,
    ga: 0,
    nai: 0
};
```

Another example:

```javascript
const round = {
    id: "abc123",
    dice: ["cua", "cua", "tom"],
    totalBet: 150,
    totalReturn: 400,
    profit: 250
};
```

You should understand:

```javascript
round.profit
round["profit"]
```

---

# 13. Destructuring

Example:

```javascript
const { balance, history } = state;
```

For arrays:

```javascript
const [dice1, dice2, dice3] = dice;
```

Use it only when it improves readability.

---

# 14. Spread Syntax

Useful example:

```javascript
const copiedBets = { ...bets };
```

Avoid mutation when a copy makes the logic clearer.

---

# 15. Functions

The code should be organized into small functions.

Good names:

```javascript
selectChip()
placeBet()
resetBets()
getTotalBet()
renderBets()
playRound()
renderResult()
renderHistory()
calculateStatistics()
```

Avoid giant 200-line handlers.

---

# 16. Arrow Functions

Know:

```javascript
const double = number => number * 2;
```

Use arrow functions naturally in callbacks:

```javascript
history.filter(round => round.profit > 0);
```

Do not convert every function to an arrow function just for style.

---

# 17. Loops

Know:

```javascript
for (const symbol of symbols) {
    ...
}
```

Use this when sequentially processing values.

---

# 18. Array Methods

The lecture specifically covers:

- `forEach`
- `map`
- `filter`
- `reduce`

## 18.1 `forEach`

Visits each item.

```javascript
symbols.forEach(symbol => {
    console.log(symbol);
});
```

## 18.2 `map`

Transforms an array into another array.

```javascript
const names = history.map(round => round.id);
```

## 18.3 `filter`

Keeps matching items.

```javascript
const wins = history.filter(round => round.profit > 0);
```

## 18.4 `reduce`

Combines values into one value.

Ideal project usage:

```javascript
const totalBet = Object.values(bets)
    .reduce((sum, value) => sum + value, 0);
```

Use these methods where they naturally make sense.

---

# 19. DOM Manipulation

Know the DOM as the browser's in-memory tree representation of the page.

Useful selectors:

```javascript
document.getElementById("balance");
document.querySelector(".chip");
document.querySelectorAll(".symbol-card");
```

---

# 20. `textContent` vs `innerHTML`

Prefer:

```javascript
element.textContent = message;
```

for ordinary text.

Use `innerHTML` only when HTML parsing is genuinely required.

For dynamic game/server data, prefer `textContent`.

Why:

- avoids unnecessary HTML parsing
- safer
- easier to reason about

---

# 21. Creating Elements

For game history:

```javascript
const row = document.createElement("li");
row.textContent = "...";
historyList.append(row);
```

This demonstrates DOM construction properly.

---

# 22. Events

Use:

```javascript
button.addEventListener("click", handler);
```

Project events include:

- chip click
- symbol click
- reset click
- shake click
- reset game click

Know why event listeners are needed:

> They allow JavaScript to react to user actions.

---

# 23. Forms and `preventDefault()`

If forms are used:

```javascript
form.addEventListener("submit", event => {
    event.preventDefault();
});
```

Why:

> Default form submission reloads/navigates the page.

---

# 24. Input Validation

Frontend validation improves UX.

But:

> Frontend validation is not enough for security or correctness.

The server must validate again because a user can bypass browser code.

---

# 25. Asynchronous JavaScript

You must understand that network requests do not complete instantly.

Core concepts:

- Promise
- `async`
- `await`
- `fetch`
- `try/catch`

Example:

```javascript
async function loadState() {
    try {
        const response = await fetch("/api/state");

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const state = await response.json();
        renderState(state);
    } catch (error) {
        showError("Could not load the game.");
    }
}
```

---

# 26. Why `response.ok` Matters

`fetch()` does not automatically throw an error for every HTTP error status.

So check:

```javascript
if (!response.ok) {
    throw new Error(...);
}
```

Then handle it:

```javascript
catch (error) {
    ...
}
```

---

# 27. JSON

The frontend and backend exchange JSON.

Request:

```json
{
    "bets": {
        "cua": 100,
        "tom": 50
    }
}
```

Response:

```json
{
    "dice": ["cua", "cua", "tom"],
    "totalBet": 150,
    "totalReturn": 400,
    "profit": 250,
    "balance": 1250
}
```

Know:

```javascript
JSON.stringify(...)
JSON.parse(...)
response.json()
```

---

# 28. Node.js Knowledge You Need

The project should clearly show Node.js fundamentals.

---

## 28.1 Node.js runtime

Understand:

- browser JavaScript has `window` and `document`
- Node.js does not have the browser DOM
- Node.js can access files, HTTP, processes, events, etc.

---

# 29. ES Modules

Use:

```javascript
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
```

And in `package.json`:

```json
{
    "type": "module"
}
```

Know the purpose of:

```javascript
import
export
```

---

# 30. Node Built-in Modules

Relevant course modules:

```text
node:http
node:fs/promises
node:path
node:events
node:process
```

Core project needs mainly:

```text
node:http
node:fs/promises
```

Optional SSE bonus may use:

```text
node:events
```

---

# 31. `node:http`

Create server:

```javascript
import { createServer } from "node:http";

createServer((req, res) => {
    ...
}).listen(3000);
```

Understand:

```text
req.method
req.url
res.writeHead(...)
res.end(...)
```

---

# 32. Routes

A route is conceptually:

```text
HTTP method + path
```

Examples:

```text
GET  /api/config
GET  /api/state
POST /api/play
POST /api/reset
```

Unknown route:

```text
404 Not Found
```

---

# 33. HTTP Status Codes Used

Use:

```text
200 OK
400 Bad Request
404 Not Found
500 Internal Server Error
```

Optional:

```text
201 Created
```

if creating a resource.

For this project, `POST /api/play` may simply return `200`.

---

# 34. Reading Request Bodies

Concept:

```javascript
async function readBody(req) {
    let text = "";

    for await (const chunk of req) {
        text += chunk;
    }

    return JSON.parse(text);
}
```

You should understand:

- body arrives in chunks
- Node combines them
- JSON text is parsed into a JavaScript object

---

# 35. Server-side Validation

The browser runs on the visitor's machine.

Therefore the user can bypass frontend validation.

The server must verify:

```text
bets exists
bets is an object
only allowed symbols are used
values are numbers
values are finite
values are integers
values >= 0
total bet > 0
total bet <= server balance
```

Invalid request:

```text
HTTP 400
```

---

# 36. `node:fs/promises`

Use to read:

```text
game-config.json
```

Example:

```javascript
const text = await readFile("game-config.json", "utf8");
const config = JSON.parse(text);
```

This is a direct application of the Node.js lecture.

---

# 37. npm

Know these files:

## `package.json`

Describes project intent:

- project name
- scripts
- dependencies
- devDependencies

## `package-lock.json`

Locks dependency versions for reproducible installs.

## `node_modules`

Installed packages.

Do not commit unnecessary generated files.

---

# 38. Dependency vs DevDependency

Runtime dependency:

```text
nanoid
```

because the server uses it when running.

Development dependency:

```text
vite
```

because Vite develops/builds the frontend.

Know:

```bash
npm install nanoid
npm install --save-dev vite
```

---

# 39. Vite

Vite is part of the taught build-tooling workflow.

Use a vanilla project.

Know these commands:

```bash
npm run dev
npm run build
npm run preview
```

Meaning:

## `npm run dev`

- development server
- fast reload/HMR
- readable source modules
- proxy works

## `npm run build`

- generates `dist/`
- bundles/minifies assets
- produces deployable files

## `npm run preview`

- serves the built `dist/` output

---

# 40. Vite Proxy

Development setup:

```javascript
export default {
    server: {
        proxy: {
            "/api": "http://localhost:3000"
        }
    }
};
```

Frontend:

```javascript
fetch("/api/state");
```

Vite forwards the request to Node.

Why this matters:

- browser requests its own Vite origin
- Vite forwards `/api` to port 3000
- avoids development CORS problems

You should understand that the development proxy does not automatically exist in production.

---

# 41. Event Loop — Conceptual Understanding

You do not need to build a complex event-loop demo.

Understand:

- JavaScript executes synchronous code first
- asynchronous work completes later
- callbacks/promises are queued
- a `0ms` timer does not mean “execute immediately”

This explains why network operations and timers are asynchronous.

---

# 42. Core Project Specification

# Bau Cua Arena

**Subtitle:** An Online Vietnamese Dice Game

Educational simulation using virtual coins only.

No real money.

---

# 43. Core Features

Implement only these core features first:

1. Game landing/header area
2. Six Bầu Cua symbols
3. Virtual balance
4. Chip selector
5. Betting
6. Reset current bet
7. Shake/play action
8. Node-generated dice
9. Server-side payout calculation
10. Result display
11. Game history
12. Player statistics
13. Reset game
14. How to Play
15. Responsive UI
16. Error/loading states

---

# 44. Technologies

Use only:

```text
HTML5
CSS3
Vanilla JavaScript ES6+
Node.js
Vite
nanoid
JSON
Fetch API
```

Do not add another dependency without explicit approval.

---

# 45. Technologies Not to Use

Do NOT use:

```text
React
Vue
Angular
Next.js
TypeScript
Express
Tailwind
Bootstrap
jQuery
PHP
MySQL
MongoDB
SQLite
Firebase
Supabase
JWT
OAuth
Socket.IO
WebSocket libraries
Chart.js
animation libraries
state-management libraries
ORMs
```

Reason:

> They do not improve syllabus alignment for this version of the project.

---

# 46. Recommended Architecture

```text
                         USER
                           |
                           v
                    Browser UI
                  HTML + CSS + JS
                           |
                    fetch("/api")
                           |
                           v
                    Vite :5173
                           |
                       proxy
                           |
                           v
                   Node.js :3000
                           |
              +------------+------------+
              |                         |
        game-config.json          in-memory state
                                      |
                               balance + history
```

---

# 47. Server State

Use:

```javascript
const gameState = {
    balance: 1000,
    history: []
};
```

No database.

Restarting Node resets the project.

That is intentional.

---

# 48. Game Configuration

Create:

```text
game-config.json
```

Suggested data:

```json
{
    "initialBalance": 1000,
    "chips": [10, 50, 100, 500],
    "symbols": [
        {
            "id": "bau",
            "name": "Bầu",
            "icon": "🍐"
        },
        {
            "id": "cua",
            "name": "Cua",
            "icon": "🦀"
        },
        {
            "id": "tom",
            "name": "Tôm",
            "icon": "🦐"
        },
        {
            "id": "ca",
            "name": "Cá",
            "icon": "🐟"
        },
        {
            "id": "ga",
            "name": "Gà",
            "icon": "🐓"
        },
        {
            "id": "nai",
            "name": "Nai",
            "icon": "🦌"
        }
    ]
}
```

---

# 49. API

Keep the API small.

## GET `/api/config`

Returns game configuration.

## GET `/api/state`

Returns:

```json
{
    "balance": 1000,
    "history": []
}
```

## POST `/api/play`

Request:

```json
{
    "bets": {
        "bau": 0,
        "cua": 100,
        "tom": 50,
        "ca": 0,
        "ga": 0,
        "nai": 0
    }
}
```

Server:

1. parses body
2. validates bets
3. calculates total bet
4. verifies balance
5. generates exactly 3 dice
6. calculates payout
7. updates balance
8. generates round ID with `nanoid`
9. saves round to history
10. returns JSON

## POST `/api/reset`

Reset:

```text
balance = initialBalance
history = []
```

---

# 50. Payout Rule

For a bet on one symbol:

```text
0 matches:
return = 0

1 match:
return = bet + 1 × bet

2 matches:
return = bet + 2 × bet

3 matches:
return = bet + 3 × bet
```

Example:

```text
Bet:
Cua = 100
Tom = 50

Dice:
Cua Cua Tom

Total stake = 150

Cua return:
100 + 2 × 100 = 300

Tom return:
50 + 1 × 50 = 100

Total return = 400

Profit = 400 - 150 = +250
```

Balance:

```text
Before:        1000
Stake:         -150
Return:        +400
Final:         1250
```

The Node server is authoritative.

---

# 51. Frontend State

Suggested:

```javascript
let selectedChip = 10;

let bets = {
    bau: 0,
    cua: 0,
    tom: 0,
    ca: 0,
    ga: 0,
    nai: 0
};
```

Do not make frontend balance authoritative.

Balance displayed in the browser should come from server state/results.

---

# 52. Game UI

Suggested desktop layout:

```text
+--------------------------------------------------+
| BAU CUA ARENA                   Balance: 1000    |
+--------------------------------------------------+
|                                                  |
|                   ?   ?   ?                      |
|                                                  |
+--------------------------------------------------+
|      BẦU          CUA          TÔM               |
|      🍐           🦀           🦐                |
|       0           100           0                |
|                                                  |
|      CÁ           GÀ           NAI               |
|      🐟           🐓           🦌                |
|      50            0            0                |
+--------------------------------------------------+
| Chip: [10] [50] [100] [500]                     |
|                                                  |
| Total Bet: 150                                   |
|                                                  |
| [ RESET BET ]                     [ SHAKE ]      |
+--------------------------------------------------+
```

---

# 53. Game Flow

```text
Page loads
   |
   v
GET /api/config
   |
   v
GET /api/state
   |
   v
Render UI
   |
   v
Player selects chip
   |
   v
Player clicks symbols
   |
   v
Frontend updates bets
   |
   v
SHAKE
   |
   v
POST /api/play
   |
   v
Node validates
   |
   v
Node generates dice
   |
   v
Node calculates result
   |
   v
Node updates state
   |
   v
JSON response
   |
   v
Frontend renders result/history/statistics
```

---

# 54. Loading and Error States

While a game request is running:

```text
disable:
- chip buttons
- symbol buttons
- reset current bet
- shake button
```

Show:

```text
Shaking...
```

After response:

- show result
- re-enable controls

On failure:

```text
Could not complete the round. Please try again.
```

Do not hide user-facing errors only in Console.

---

# 55. History

Round shape:

```javascript
{
    id,
    dice,
    bets,
    totalBet,
    totalReturn,
    profit,
    balanceAfter,
    createdAt
}
```

Keep latest:

```text
20–30 rounds
```

Display:

```text
Round ID | Result | Bet | Return | Profit
```

Responsive alternative:

- desktop table
- mobile cards

---

# 56. Statistics

Derive from history.

Show:

```text
Games played
Wins
Losses
Break-even rounds
Win rate
Current balance
Highest observed balance
Total bet
Total returned
```

Use `filter` and `reduce`.

Example:

```javascript
const wins = history.filter(round => round.profit > 0);

const totalBet = history.reduce(
    (sum, round) => sum + round.totalBet,
    0
);
```

---

# 57. How to Play

Include:

```text
1. Select a virtual chip.
2. Choose one or more symbols.
3. Press SHAKE.
4. The Node server generates three symbols.
5. Your return depends on the number of matches.
```

Display clearly:

> Virtual coins are for educational demonstration only and have no monetary value.

---

# 58. Suggested File Structure

```text
bau-cua-arena/
│
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
├── server.js
├── game-config.json
├── README.md
├── EXPLANATION.md
├── .gitignore
│
├── public/
│   └── assets/
│
└── src/
    ├── main.js
    ├── game.js
    ├── ui.js
    ├── statistics.js
    └── style.css
```

If this feels too fragmented, combine files.

Good alternative:

```text
src/
├── main.js
├── game.js
└── style.css
```

Prefer clarity over file count.

---

# 59. Implementation Roadmap

## PHASE 0 — Understand Before Coding

Study:

- client/server
- HTTP request/response
- HTML semantic tags
- CSS box model
- Flexbox
- Grid
- DOM
- events
- arrays/objects
- map/filter/reduce
- async/await
- fetch
- Node server
- GET/POST
- JSON
- Vite
- proxy

Do not start coding until you can explain the architecture diagram.

---

# 60. PHASE 1 — Project Setup

Tasks:

```bash
npm create vite@latest . -- --template vanilla
npm install
npm install nanoid
```

Confirm:

```text
vite is devDependency
nanoid is dependency
"type": "module"
```

Create:

```text
server.js
game-config.json
vite.config.js
```

Add scripts:

```json
{
    "dev": "vite",
    "server": "node server.js",
    "build": "vite build",
    "preview": "vite preview"
}
```

Test:

```bash
npm run dev
npm run server
```

Success criterion:

- Vite opens
- Node starts on 3000
- no terminal errors

---

# 61. PHASE 2 — Build the Node Server First

Implement:

```text
GET /api/config
GET /api/state
```

Before making the game.

Test manually in browser/curl.

Expected:

```text
/api/config -> JSON
/api/state -> JSON
unknown route -> 404
```

Why first?

> It proves the client/server architecture works before adding game complexity.

---

# 62. PHASE 3 — Vite Proxy

Create proxy:

```text
/api -> http://localhost:3000
```

Frontend test:

```javascript
fetch("/api/config")
```

Verify in DevTools Network tab.

Success:

- request made from Vite page
- response comes from Node
- no CORS error

---

# 63. PHASE 4 — Semantic HTML

Build static structure before JavaScript.

Include:

```text
header
nav
main
game section
statistics section
how-to-play section
footer
```

Use proper buttons.

Test keyboard tab navigation.

---

# 64. PHASE 5 — CSS Layout

Implement in this order:

1. `box-sizing`
2. typography
3. page spacing
4. navigation Flexbox
5. game Grid
6. chip Flexbox
7. result panel
8. history
9. hover/focus
10. media queries

Do not add fancy animations yet.

---

# 65. PHASE 6 — Load Config with Fetch

Frontend:

```text
GET /api/config
```

Use:

```javascript
async/await
try/catch
response.ok
```

Dynamically render symbols/chips if appropriate.

If dynamic rendering becomes harder to explain than static markup, static markup is acceptable for the six symbols, but API config should still be used meaningfully.

---

# 66. PHASE 7 — Betting Logic

Implement:

```javascript
selectChip()
placeBet()
resetBets()
getTotalBet()
renderBets()
```

Tests:

```text
select 50
click Cua
Cua = 50

click Cua again
Cua = 100

click Tom
Tom = 50

Total = 150

Reset
all = 0
```

Do not connect SHAKE yet.

---

# 67. PHASE 8 — POST `/api/play`

Server first.

Implement:

```text
read body
validate
generate dice
calculate payout
update balance
create round
push history
send JSON
```

Test API directly before connecting UI.

Test:

```text
valid request
no bets
negative bet
unknown symbol
too much bet
bad JSON
```

---

# 68. PHASE 9 — Connect SHAKE

Frontend flow:

```text
validate current bet
disable controls
show Loading/Shaking
POST /api/play
check response.ok
read JSON
render result
reset frontend bets
update balance
update history
re-enable controls
```

Use one readable async function.

---

# 69. PHASE 10 — History

Implement:

```javascript
renderHistory(history)
```

Use:

```text
createElement
textContent
append
```

Avoid building server data directly with unsafe `innerHTML`.

---

# 70. PHASE 11 — Statistics

Implement:

```javascript
calculateStatistics(history)
renderStatistics(...)
```

Use:

```text
filter
reduce
```

Do not use a chart library.

---

# 71. PHASE 12 — Responsive Design

Test:

```text
Desktop ~1440px
Laptop ~1024px
Tablet ~768px
Mobile ~375px
Small mobile ~320px
```

Check:

- no horizontal overflow
- grid adapts
- buttons wrap
- text readable
- history usable

Use Chrome DevTools device toolbar.

---

# 72. PHASE 13 — Small Shake Animation

Only now add animation.

Use CSS:

```css
@keyframes ...
```

or small class transition.

No library.

The animation must never determine game result.

Node result remains final.

---

# 73. PHASE 14 — Reset Game

Implement:

```text
POST /api/reset
```

Frontend asks confirmation.

Then:

```text
balance = 1000
history = []
bets = 0
statistics reset
```

---

# 74. PHASE 15 — Error Handling

Manually test:

- Node server off
- invalid API URL
- malformed request
- insufficient balance
- repeated shake click
- zero bet
- unknown route

All failures should produce understandable UI.

---

# 75. PHASE 16 — Build Test

Run:

```bash
npm run build
```

Inspect:

```text
dist/
```

Then:

```bash
npm run preview
```

Understand:

> The dev proxy is development-only, so document this limitation clearly.

For final classroom demo, running Vite dev + Node server is acceptable unless the lecturer requires production deployment.

---

# 76. PHASE 17 — README

README should contain:

```text
Description
Educational purpose
Technologies
Architecture
Features
Game rules
API
Installation
Development commands
Build commands
Project structure
Course concepts demonstrated
Limitations
Manual test checklist
```

---

# 77. PHASE 18 — EXPLANATION.md

Create an oral-defense guide.

You must be able to explain:

1. Client vs server
2. HTTP
3. HTML vs HTTP
4. Semantic HTML
5. Block vs inline
6. CSS specificity
7. Box model
8. Why `border-box`
9. Flexbox vs Grid
10. Media queries
11. `const` vs `let`
12. Arrays
13. Objects
14. `map`
15. `filter`
16. `reduce`
17. DOM
18. `textContent`
19. `addEventListener`
20. `async/await`
21. `fetch`
22. `response.ok`
23. `try/catch`
24. JSON
25. Node vs browser JavaScript
26. `node:http`
27. `node:fs/promises`
28. GET vs POST
29. HTTP 400/404/500
30. Why server validates again
31. `package.json`
32. `package-lock.json`
33. dependency vs devDependency
34. Vite
35. Vite proxy
36. `npm run dev` vs `npm run build`
37. Why no database
38. Why no Express
39. Why no React
40. Why virtual coins only

---

# 78. Manual Test Checklist

## Setup

- [ ] `npm install` succeeds
- [ ] `npm run server` succeeds
- [ ] `npm run dev` succeeds
- [ ] page opens on Vite URL

## Config/API

- [ ] `GET /api/config`
- [ ] `GET /api/state`
- [ ] unknown API route -> 404

## Game

- [ ] initial balance = 1000
- [ ] select chip 10
- [ ] select chip 50
- [ ] select chip 100
- [ ] select chip 500
- [ ] bet on each of six symbols
- [ ] bet on multiple symbols
- [ ] total bet correct
- [ ] reset current bet works
- [ ] zero-bet shake blocked
- [ ] player cannot obviously exceed balance
- [ ] POST `/api/play` works
- [ ] exactly three dice returned
- [ ] result displayed
- [ ] balance updated
- [ ] history updated
- [ ] statistics updated

## Validation

- [ ] server rejects negative bet
- [ ] server rejects NaN/non-number
- [ ] server rejects unknown symbol
- [ ] server rejects zero total
- [ ] server rejects total > balance
- [ ] malformed JSON does not crash server

## UX

- [ ] loading state shown
- [ ] duplicate SHAKE blocked
- [ ] errors shown on page
- [ ] keyboard focus visible
- [ ] mobile UI works
- [ ] no normal-use Console errors

## Build

- [ ] `npm run build` succeeds
- [ ] `npm run preview` succeeds

---

# 79. Scope Control

Do not add these before the project is fully stable:

```text
multiplayer
login
register
database
chat
admin dashboard
real money
payments
JWT
OAuth
WebSockets
Socket.IO
React
TypeScript
Express
Tailwind
Bootstrap
Chart.js
cloud APIs
```

If Codex proposes one of them:

> Reject it unless there is a direct syllabus-based reason.

---

# 80. Optional Bonus

Only after all core criteria pass.

Possible bonus:

## Server-Sent Events

Use concepts from Node.js live updates:

```text
node:events
EventEmitter
GET /api/events
```

Could show:

```text
LIVE ROUND FEED
```

But this is optional.

Do not add it if it increases demo risk.

---

# 81. Feature-to-Syllabus Mapping

| Project Feature | Course Concept |
|---|---|
| Page structure | Semantic HTML |
| Navigation | HTML + Flexbox |
| Six-symbol board | CSS Grid |
| Symbol cards | Box model |
| Responsive mobile layout | Media queries |
| Hover/focus feedback | Pseudo-classes |
| Chip selection | DOM + events |
| Bets object | JavaScript objects |
| Symbol/config list | Arrays |
| Total bet | `reduce()` |
| Win/loss filtering | `filter()` |
| History transformation | `map()` |
| Result rendering | DOM + `textContent` |
| API calls | Fetch |
| Network waiting | Promise / async-await |
| Failure handling | `response.ok` + `try/catch` |
| Config transfer | JSON |
| API server | `node:http` |
| Config file | `node:fs/promises` |
| POST validation | Server-side validation |
| Round ID | npm + `nanoid` |
| Development setup | Vite |
| Client/server bridge | Vite proxy |
| Production bundle | `npm run build` |

---

# 82. High-Score Strategy

The project should score well by being strong in five areas.

## A. Syllabus alignment

Every important technical choice should map to something taught.

## B. Correctness

Game rules and balance logic must be correct.

## C. Explainability

You should be able to explain every important function.

## D. Visual quality

Clean, responsive, consistent design.

## E. Demonstration quality

Prepare a short reliable demo flow.

---

# 83. Recommended Final Demo Flow

Target: approximately 5–7 minutes.

## Step 1 — Architecture

Explain:

```text
HTML/CSS/JS frontend
        |
       fetch
        |
       Vite
        |
       proxy
        |
    Node API
```

## Step 2 — Responsive UI

Show desktop.

Open DevTools mobile view.

Show Grid adaptation.

## Step 3 — Betting

Select:

```text
100
```

Bet:

```text
Cua = 100
Tom = 100
```

Explain the `bets` object and DOM events.

## Step 4 — SHAKE

Click SHAKE.

Explain:

```text
fetch POST /api/play
```

Open Network tab if useful.

## Step 5 — Node result

Explain:

- validation
- random 3 symbols
- payout
- JSON response

## Step 6 — History/statistics

Show updated values.

Mention:

```text
filter
reduce
```

## Step 7 — Error handling

Try SHAKE with zero bet.

Show user-facing validation.

## Step 8 — Code

Open 2–3 important functions only:

```text
playRound()
validateBets()
renderHistory()
```

Do not scroll randomly through the entire project.

---

# 84. Study Order Before Oral Defense

Study in this exact order.

## Level 1 — Must know

```text
HTML semantic tags
CSS selectors
box model
Flexbox
Grid
media queries
const / let
arrays
objects
functions
DOM
events
fetch
async/await
Node HTTP server
GET / POST
JSON
```

## Level 2 — Needed for high score

```text
specificity
textContent vs innerHTML
map/filter/reduce
response.ok
try/catch
server-side validation
ES modules
fs/promises
npm
dependencies
devDependencies
Vite proxy
build process
```

## Level 3 — Bonus understanding

```text
event loop
CORS
same-origin
SSE
production vs development proxy
```

---

# 85. What You Should Be Able to Explain Without Notes

Before submitting, answer these out loud.

### HTML/CSS

1. Why use `<main>` instead of only `<div>`?
2. What is the box model?
3. Why `box-sizing: border-box`?
4. Why is the board Grid instead of Flexbox?
5. Why is the chip row Flexbox instead of Grid?
6. What is a media query?
7. What does `:hover` mean?
8. What is specificity?

### JavaScript

9. Why is `selectedChip` declared with `let`?
10. Why is `symbols` declared with `const`?
11. Why use an object for bets?
12. What does `reduce()` do?
13. What is the DOM?
14. Why `addEventListener()`?
15. Why prefer `textContent`?
16. What does `async` mean?
17. What does `await fetch()` do?
18. Why check `response.ok`?
19. Why use `try/catch`?

### Node/Web

20. What is HTTP?
21. What is a client?
22. What is a server?
23. Difference between GET and POST?
24. What does `node:http` do?
25. Why does the Node server validate bets again?
26. Why does Node generate the final dice?
27. Why JSON?
28. What does `node:fs/promises` do?
29. What is package.json?
30. What is package-lock.json?
31. Difference between dependency and devDependency?
32. Why is Vite a devDependency?
33. What does the proxy do?
34. Why no database?
35. Why no Express?
36. Why no React?

If you cannot answer one, study that concept before presentation.

---

# 86. CODEx MASTER PROMPT

Paste the following section into Codex when starting implementation.

---

## CODEX INSTRUCTION

You are implementing my university Web Application Development final project.

Project:

**Bau Cua Arena – An Online Vietnamese Dice Game**

Read this entire markdown file before changing any code.

Your priority order is:

1. syllabus alignment
2. correctness
3. explainability
4. clean code
5. responsive UI
6. reliable demonstration

Use only:

- HTML5
- CSS3
- Vanilla JavaScript ES6+
- Node.js
- Vite
- nanoid
- JSON
- Fetch API

Do not introduce:

- React
- Vue
- Angular
- TypeScript
- Express
- Tailwind
- Bootstrap
- jQuery
- PHP
- databases
- authentication
- WebSocket libraries
- chart libraries
- animation libraries

unless I explicitly request them later.

The code must be understandable to a university student who may be asked to explain any line orally.

Use small readable functions.

Prefer concepts covered in the course:

- semantic HTML
- accessibility
- CSS selectors and specificity
- box model
- Flexbox
- Grid
- responsive media queries
- ES6+
- arrays and objects
- map/filter/reduce
- DOM manipulation
- events
- async/await
- fetch
- response.ok
- try/catch
- JSON
- Node.js ES modules
- node:http
- node:fs/promises
- HTTP routes
- server-side validation
- npm
- Vite
- Vite proxy

Architecture:

```text
Browser / Vite :5173
        |
        | fetch("/api/...")
        v
Vite development proxy
        |
        v
Node.js API :3000
        |
        +-- game-config.json
        +-- in-memory game state
```

Core API:

```text
GET  /api/config
GET  /api/state
POST /api/play
POST /api/reset
```

Core project only.

No database.

No login.

No multiplayer.

Virtual coins only.

Implement using the phases described in this document.

### Development rule

Do one phase at a time.

After every phase:

1. run relevant commands
2. test the feature
3. inspect browser console / terminal
4. fix errors
5. only then continue

Do not leave broken code for later.

### Before editing

First:

1. inspect the existing project
2. summarize current files
3. state which phase you are implementing
4. identify the exact files you will modify

Then implement.

### After each phase

Report:

```text
PHASE COMPLETED:
FILES CHANGED:
WHAT WAS IMPLEMENTED:
HOW TO TEST:
COURSE CONCEPTS USED:
KNOWN LIMITATIONS:
```

Do not add bonus features until all core acceptance tests pass.

---

# 87. Codex Phase Prompts

Instead of asking Codex to build the whole application in one huge request, use these prompts one at a time.

---

## Prompt 1 — Setup

```text
Implement PHASE 1 from PROJECT_CONTEXT.md.

Set up:
- Vite vanilla
- ES modules
- nanoid
- scripts
- server.js
- game-config.json
- Vite proxy

Do not implement the game yet.

Run/test the setup and report results.
```

---

## Prompt 2 — Server Basics

```text
Implement PHASE 2.

Create only:

GET /api/config
GET /api/state
404 handling

Use node:http and node:fs/promises.

Do not add Express.

Test each route before continuing.
```

---

## Prompt 3 — HTML + CSS

```text
Implement PHASES 4 and 5.

Create semantic HTML and responsive CSS.

Demonstrate:
- semantic tags
- box model
- Flexbox
- Grid
- pseudo-classes
- media queries
- keyboard focus

Do not add game JavaScript yet.
```

---

## Prompt 4 — Frontend State

```text
Implement PHASES 6 and 7.

Add:
- GET /api/config with fetch
- async/await
- response.ok
- try/catch
- chip selection
- bets object
- total bet using reduce
- DOM events
- reset current bet

Do not implement POST /api/play yet.
```

---

## Prompt 5 — Game API

```text
Implement PHASE 8.

Create POST /api/play.

Requirements:
- parse JSON
- validate all bets server-side
- generate exactly 3 dice
- calculate payout
- update authoritative server balance
- create round ID with nanoid
- store history in memory
- return JSON
- invalid request -> HTTP 400
- malformed JSON must not crash server

Test API independently before touching frontend.
```

---

## Prompt 6 — Connect Game

```text
Implement PHASE 9.

Connect the SHAKE button to POST /api/play.

Use:
- fetch
- async/await
- response.ok
- try/catch

Add:
- loading state
- disabled controls
- result rendering
- balance update
- frontend bet reset
- user-facing errors

Do not add extra features.
```

---

## Prompt 7 — History + Statistics

```text
Implement PHASES 10 and 11.

Add responsive history and statistics.

Use:
- createElement
- textContent
- append
- map/filter/reduce where natural

Do not use Chart.js.
```

---

## Prompt 8 — Final Polish

```text
Implement PHASES 12–18.

Do:
- responsive testing
- simple CSS shake feedback
- reset game API/UI
- error testing
- npm run build
- README.md
- EXPLANATION.md
- manual test checklist

Do not introduce any new dependency.
```

---

# 88. Final Acceptance Criteria

Project is complete only when all are true:

## Environment

- [ ] `npm install`
- [ ] `npm run server`
- [ ] `npm run dev`
- [ ] Vite page works
- [ ] Node API works
- [ ] Vite proxy works

## HTML/CSS

- [ ] semantic structure
- [ ] accessible buttons
- [ ] box model
- [ ] Flexbox used appropriately
- [ ] Grid used appropriately
- [ ] hover/focus
- [ ] responsive media queries
- [ ] no page-level horizontal overflow

## JavaScript

- [ ] const/let used correctly
- [ ] arrays/objects
- [ ] readable functions
- [ ] DOM selection
- [ ] event listeners
- [ ] textContent
- [ ] createElement/append for history
- [ ] reduce
- [ ] filter
- [ ] async/await
- [ ] fetch
- [ ] response.ok
- [ ] try/catch

## Node

- [ ] ES modules
- [ ] `node:http`
- [ ] `node:fs/promises`
- [ ] JSON
- [ ] GET routes
- [ ] POST routes
- [ ] 400 validation
- [ ] 404
- [ ] malformed JSON handling
- [ ] nanoid
- [ ] authoritative balance

## Game

- [ ] initial balance 1000
- [ ] chips 10/50/100/500
- [ ] six symbols
- [ ] multiple bets
- [ ] total correct
- [ ] reset bet
- [ ] zero-bet blocked
- [ ] exactly three dice
- [ ] payout correct
- [ ] result shown
- [ ] history shown
- [ ] statistics shown
- [ ] reset game
- [ ] virtual coins only

## Tooling

- [ ] Vite in devDependencies
- [ ] nanoid in dependencies
- [ ] package-lock committed
- [ ] `npm run build` passes
- [ ] README complete
- [ ] EXPLANATION.md complete

---

# 89. Final Rule for Codex

If a feature does not help demonstrate the syllabus or improve reliability/usability, do not add it.

If two solutions work, choose the one:

1. closer to lecture material
2. easier to explain
3. easier to test
4. less dependent on external libraries

The project should look professional, but the strongest evidence of learning should be visible in the source code.

---

# 90. Source Basis

This guide was prepared from the uploaded Web Application Development materials, especially:

- `1. Introduction to Internet & WWW.pdf`
- `2. Introduction to HTML + CSS.pdf`
- `3. JavaScript.pdf`
- `4. NodeJS Fundamental.pdf`
- `Exercise1 - HTML+CSS (Basic).pdf`
- `Exercise1.2 - HTML+CSS (Advanced).pdf`
- `Exercise2 - JavaScript.pdf`
- `Exercise2.2_JavaScript.pdf`

Key syllabus themes reflected here:

- client/server and HTTP
- semantic HTML and accessibility
- CSS box model, Flexbox, Grid, responsive design
- ES6+, objects, arrays, DOM, events
- map/filter/reduce
- async/await, Fetch API, error handling
- Node.js runtime and modules
- npm
- Vite build tooling
- first HTTP server
- JSON APIs
- POST validation
- live-update concepts as optional bonus

