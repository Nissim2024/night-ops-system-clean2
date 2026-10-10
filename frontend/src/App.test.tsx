import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

// With no saved session the app opens on the login screen (replaces CRA's
// "learn react" placeholder, which never matched anything — regression 2026-10-10).
test('no session → login screen', async () => {
  localStorage.removeItem('deploycenter_token');
  render(<App />);
  expect((await screen.findAllByText('התחברות למערכת')).length).toBeGreaterThan(0);
});
