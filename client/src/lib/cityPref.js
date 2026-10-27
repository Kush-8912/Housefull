import { useSyncExternalStore } from 'react';

// The visitor's chosen city, remembered in this browser. Storage can be
// unavailable (private mode, blocked site data); then it just isn't remembered.
const KEY = 'housefull:city';
const EVT = 'housefull:city-change';

function read() {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

// Set once the visitor has picked anything, including "All cities", so the
// city picker only opens by itself on a first visit.
const CHOSEN = 'housefull:city-chosen';

export function setCityPref(city) {
  try {
    if (city) localStorage.setItem(KEY, city);
    else localStorage.removeItem(KEY);
    localStorage.setItem(CHOSEN, '1');
  } catch { /* not remembered */ }
  window.dispatchEvent(new Event(EVT));
}

export function hasChosenCity() {
  try {
    return localStorage.getItem(CHOSEN) === '1' || Boolean(localStorage.getItem(KEY));
  } catch {
    return true; // can't remember a choice, so don't keep asking
  }
}

const subscribe = (cb) => {
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', cb); // other tabs
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', cb);
  };
};

export const useCityPref = () => useSyncExternalStore(subscribe, read, () => '');
