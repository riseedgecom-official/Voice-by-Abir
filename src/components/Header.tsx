import { User } from "firebase/auth";
import { ActiveTab } from "../types/studio";

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  user: User | null;
  hasToken: boolean;
  isSigningIn: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function Header({
  activeTab,
  onSelectTab,
  user,
  hasToken,
  isSigningIn,
  onSignIn,
  onSignOut,
}: HeaderProps) {
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: "studio", label: "Studio" },
    { id: "voices", label: "Voice Profiles" },
    { id: "library", label: "Cloud Library" },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-8 px-6">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectTab("studio")}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          Voice by Abir
        </button>

        {/* Zone 2: Clean Single-Line Navigation Links */}
        <nav aria-label="Primary navigation" className="flex items-center gap-7 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:text-blue-600 ${
                  isActive
                    ? "text-slate-900"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          {user && hasToken ? (
            <button
              type="button"
              onClick={onSignOut}
              title={`Signed in as ${user.email || user.displayName || "Google User"} — Click to sign out`}
              className="inline-flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || "User avatar"}
                  referrerPolicy="no-referrer"
                  className="h-5 w-5 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                  {(user.displayName || user.email || "U").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="max-w-[140px] truncate">
                {user.displayName || user.email}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">Sign out</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              disabled={isSigningIn}
              className="gsi-material-button whitespace-nowrap shrink-0"
            >
              <div className="gsi-material-button-state" />
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: "block" }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {isSigningIn ? "Connecting..." : "Sign in with Google"}
                </span>
              </div>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
