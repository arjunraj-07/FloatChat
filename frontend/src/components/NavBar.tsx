'use client';

/**
 * Top navigation: the brand, the four sections, a detail switch and an
 * account menu.
 *
 * Two different things sit near each other here, so they are kept visibly
 * apart: **account type** is who you signed up as and lives inside the
 * account menu; **detail level** is how much explanation you want to read and
 * is a switch anyone can use, signed in or not. Changing the switch never
 * changes the account.
 *
 * Section ids stay stable while labels change, so state and focus targets are
 * unaffected by wording.
 */

import { useEffect, useRef, useState } from 'react';

import { SECTIONS, type SectionId } from '@/lib/navigation.ts';
import type { ViewMode } from '@/lib/explorerModel.ts';
import { type Account, roleLabel } from '@/lib/auth.ts';

interface Props {
  section: SectionId;
  onNavigate: (section: SectionId) => void;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  onOpenIntro?: () => void;
  /** The signed-in account, or null while exploring as a guest. */
  account?: Account | null;
  onSignOut?: () => void;
  onSignIn?: () => void;
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 36 36" role="img" aria-label="FloatChat">
      <path d="M7 22.5c3.5-2.2 6.3-2.2 9.3 0 3.1 2.2 6 2.2 9.7 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.5 18.5h15V9.2c-4.5-2.5-10.5-2.5-15 0v9.3Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M13.2 9.8V7.2M22.8 9.8V7.2M18 6.9v-2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="18" cy="13.2" r="1.25" fill="currentColor" />
    </svg>
  );
}

function DetailSwitch({
  mode,
  onModeChange,
  testIdPrefix,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  testIdPrefix: string;
}) {
  return (
    <div role="group" aria-label="Detail level" className="view-switch shrink-0">
      {(['student', 'scientific'] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-testid={`${testIdPrefix}${value}`}
          aria-pressed={mode === value}
          onClick={() => onModeChange(value)}
          className={mode === value ? 'is-selected' : ''}
        >
          {value === 'student' ? 'Simple' : 'Detailed'}
        </button>
      ))}
    </div>
  );
}

export default function NavBar({
  section,
  onNavigate,
  mode,
  onModeChange,
  onOpenIntro,
  account = null,
  onSignOut,
  onSignIn,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  const go = (id: SectionId) => {
    setMenuOpen(false);
    onNavigate(id);
  };

  // A menu that closes on an outside click or Escape, like every other menu.
  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountOpen]);

  return (
    <header className="topbar relative z-[1100] shrink-0">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-4 px-4 lg:gap-8 lg:px-6">
        <button
          type="button"
          data-testid="brand"
          onClick={() => onOpenIntro?.()}
          title={onOpenIntro ? 'Replay the introduction' : undefined}
          className="flex shrink-0 items-center gap-2"
        >
          <Mark />
          <span className="brand-word">
            Float<span>Chat</span>
          </span>
        </button>

        <nav aria-label="Sections" className="hidden h-full items-stretch gap-5 md:flex">
          {SECTIONS.map((item) => {
            const active = item.id === section;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => go(item.id)}
                className={`nav-item whitespace-nowrap ${active ? 'is-active' : ''}`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <div className="hidden sm:block">
            <DetailSwitch mode={mode} onModeChange={onModeChange} testIdPrefix="view-" />
          </div>

          {account ? (
            <div ref={accountRef} className="relative hidden lg:block">
              <button
                type="button"
                data-testid="account-button"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                onClick={() => setAccountOpen((open) => !open)}
                className="account-button"
              >
                <span aria-hidden className="account-avatar">
                  {account.email.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[9rem] truncate">{account.display_name}</span>
                <span aria-hidden className="text-[10px]">▾</span>
              </button>
              {accountOpen && (
                <div data-testid="account-menu" role="menu" className="account-menu">
                  <p data-testid="account-email" className="truncate font-semibold text-[var(--ink)]">
                    {account.email}
                  </p>
                  <p className="tiny mt-0.5">
                    Account type: <span data-testid="account-role">{roleLabel(account.role)}</span>
                  </p>
                  <p className="tiny mt-1.5 border-t border-[var(--divider)] pt-1.5">
                    Your account type sets the starting detail level. The Simple/Detailed switch
                    changes only what you read — never your account or what you can see.
                  </p>
                  <button
                    type="button"
                    data-testid="sign-out"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      onSignOut?.();
                    }}
                    className="button button-outline button-small mt-2.5 w-full"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              data-testid="sign-in"
              onClick={() => onSignIn?.()}
              className="account-button hidden lg:flex"
            >
              Sign in
            </button>
          )}

          <button
            type="button"
            data-testid="nav-menu-button"
            aria-expanded={menuOpen}
            aria-controls="nav-menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className="account-button md:hidden"
          >
            <span aria-hidden>☰</span>
            <span>{current.label}</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="nav-menu"
          data-testid="nav-menu"
          aria-label="Sections"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenuOpen(false);
          }}
          className="topbar absolute inset-x-0 top-full border-t border-[rgb(249_248_243/0.15)] pb-3 shadow-lg md:hidden"
        >
          <ul>
            {SECTIONS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid={`navmenu-${item.id}`}
                  aria-current={item.id === section ? 'page' : undefined}
                  onClick={() => go(item.id)}
                  className={`flex w-full items-center px-4 py-3 text-left text-sm ${
                    item.id === section ? 'bg-[rgb(249_248_243/0.08)] font-semibold text-white' : 'text-[#b6c7c3]'
                  }`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="px-4 pt-2 sm:hidden">
            <DetailSwitch mode={mode} onModeChange={onModeChange} testIdPrefix="menu-view-" />
          </div>
          <div className="mt-3 border-t border-[rgb(249_248_243/0.15)] px-4 pt-3">
            {account ? (
              <div data-testid="menu-account" className="flex items-center justify-between gap-3">
                <span className="text-xs text-[#b6c7c3]">
                  {account.email} · {roleLabel(account.role)}
                </span>
                <button
                  type="button"
                  data-testid="menu-sign-out"
                  onClick={() => {
                    setMenuOpen(false);
                    onSignOut?.();
                  }}
                  className="rounded-md border border-[rgb(249_248_243/0.28)] px-2.5 py-1 text-xs text-[#c5d1cf]"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="menu-sign-in"
                onClick={() => {
                  setMenuOpen(false);
                  onSignIn?.();
                }}
                className="rounded-md border border-[rgb(249_248_243/0.28)] px-2.5 py-1 text-xs text-[#c5d1cf]"
              >
                Sign in
              </button>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
