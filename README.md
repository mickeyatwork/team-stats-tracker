# Team Stats Tracker ⚽📊

A matchday tracker, squad management, and performance analytics web application built for grassroots football teams.

---

## 🌟 Key Features

### ⏱️ Live Matchday Tracker
- **Real-Time Stat Logging:** Record goals, assists, saves, attempts and defensive contributions, on the fly.
- **Match Timeline:** Compiles match events into a clean chronological timeline showing scorers, assisters, and dynamic running scorelines.
- **Captain & Player of the Match:** Feature switches to designate team captain (with armband badge `C`) and highlight the Most Influential Player / Player of the Match.
- **Multi-Format Support:** Configurable for 5-a-side, 7-a-side, 9-a-side, and 11-a-side games with customizable match durations.
- **Youth / Non-Competitive Friendly Mode:** Optional "Hide Score" toggle while still capturing positive individual player metrics.

### 🏆 Tournaments & Knockout Stages
- **Campaign Tracking:** Manage one-off multi-team tournaments alongside regular season fixtures.
- **Knockout Bracket Management:** Built-in rounds from Round of 16 through Semi-Finals, 3rd Place Play-Off, and Finals.
- **Tournament Squad Availability:** Set and adjust available player pools specifically per tournament.

### 📈 Comprehensive Squad & Player Analytics
- **Squad Breakdown Table:** Interactive stats table tracking appearances, goals, assists, total goal contributions (G+A), saves, clean sheets, captaincy, and win rates.
- **Leaderboards:** Top scorers, assist leaders, defensive anchors, and match influencers.
- **Team Dynamics:** Evaluates team performance, win percentage, and goal differential impact.
- **Form Strips & Filtering:** Inspect recent form guides (W-D-L), filterable by competition (League, Cup, Friendly, Tournament) or across full seasons.

### 📶 Offline-First Sideline Resilience
- **Zero-Signal Matchday Tracking:** Works seamlessly on remote pitches without mobile data or internet access.
- **Background Sync Engine:** Queues all matches, events, and stat adjustments in local storage.
- **Automatic Reconciliation:** Automatically syncs upon reconnecting, resolving temporary offline IDs to server UUIDs and upserting composite records safely.
- **Manual Sync Controls:** Instant visual indicator banner with a one-tap "Sync Now" action.

### 👥 Club & Multi-Team Architecture
- **Multi-Team & Multi-Season Management:** Seamlessly switch between different age groups, squads, or seasons from the navigation bar.
- **Role-Based Access Control (RBAC):** Permissions for Club Administrators, Team Managers, Coaches, and Viewers.
- **Invite-Only Security:** Request-only account provisioning with temporary password first-time activation.

---

## 🛠️ Tech Stack

- **Frontend:** [React 19](https://react.dev/), [Vite](https://vitejs.dev/)
- **Styling:** Custom CSS with theme support (Electric Cyan & Deep Crimson) and responsive tablet/desktop expansions
- **Icons:** [Lucide React](https://lucide.dev/)
- **Backend & Authentication:** [Supabase](https://supabase.com/) (PostgreSQL, Row Level Security, Supabase Auth)
- **Linter & Code Quality:** [Oxlint](https://oxc.rs/)

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm, pnpm, or yarn
- A [Supabase](https://supabase.com/) project

### 1. Clone the Repository

```bash
git clone https://github.com/mickeyatwork/team-stats-tracker.git
cd team-stats-tracker
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory and add your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Database Setup

Ensure your Supabase project contains the requisite tables:
- `clubs`: Clubs and organizations
- `teams`: Teams associated with a club
- `squad`: Registered squad players
- `matches`: Matchday fixtures, scores, competitions, and status
- `match_stats`: Composite `(match_id, player_id)` stats (goals, assists, saves, GK status, captain, potm)
- `goal_events`: Individual goal timeline rows (scorer, assister, timestamp)
- `user_profiles`: User accounts, club affiliations, roles, and status

### 5. Run Development Server

```bash
npm run dev
```

Open your browser at `http://localhost:5173`.

### 6. Build for Production

```bash
npm run build
npm run preview
```

---

## 📁 Project Structure

```
team-stats-tracker/
├── public/                  # App icon, favicon, and static assets
│   ├── app-icon.jpg         # Full-resolution modern app icon
│   ├── favicon.svg          # Vector icon for browser tabs & PWA
│   └── icons.svg
├── src/
│   ├── components/          # Reusable components (TopNav, modals, selector strips)
│   ├── utils/               # Core business logic and offline utilities
│   │   ├── authRoles.js     # User role definitions and permission checks
│   │   ├── offlineSync.js   # Offline queue, local caching, and Supabase sync engine
│   │   ├── timelineUtils.js # Match goal timeline sequence and running score logic
│   │   ├── tournamentUtils.js # Tournament parsing, stages, and standings logic
│   │   └── variantPreferences.js # Match formats (5/7/9/11-a-side)
│   ├── views/               # Primary application views
│   │   ├── AuthView.jsx     # Login and account activation
│   │   ├── MatchesView.jsx  # Fixture list, new match creation, tournament hub
│   │   ├── MatchTrackerView.jsx # Live in-game stat logger and timeline
│   │   ├── MatchReportView.jsx  # Post-match summary, player ratings, and timeline
│   │   ├── SquadView.jsx    # Squad roster management
│   │   ├── StatsView.jsx    # Comprehensive squad breakdown and dynamics
│   │   ├── TournamentView.jsx # Tournament group tables and knockout brackets
│   │   └── SettingsView.jsx # Team configuration, seasons, and user management
│   ├── index.css            # Design tokens, theme variables, and responsive layout
│   ├── main.jsx             # React application root
│   └── supabaseClient.js    # Supabase JS client configuration
├── index.html               # HTML entry point with theme initialization
└── package.json
```

---

## 🔒 Security & User Access

Account creation is restricted to **invitation or request only**:
1. A Club Administrator adds an authorized user's email with an assigned role in `user_profiles` along with a temporary password.
2. The user signs in on the login screen using their email and temporary password.
3. The application securely activates the Supabase Auth account and links the user's profile on first login.

---

## 📄 License

Private repository. All rights reserved.
