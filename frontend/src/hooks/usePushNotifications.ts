import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(Array.from(raw, c => c.charCodeAt(0)));
}

async function getRegistration() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

function playPushSound(urgent: boolean) {
  try {
    const ctx = new AudioContext();
    const beep = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.35, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    if (urgent) {
      // Triple beep for urgent (blocked)
      beep(880, 0,    0.18);
      beep(660, 0.25, 0.18);
      beep(880, 0.5,  0.18);
    } else {
      // Single double-beep for normal
      beep(660, 0,    0.15);
      beep(880, 0.2,  0.15);
    }
  } catch { /* AudioContext not available */ }
}

export interface PushState {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  loading: boolean;
  error: string | null;
}

export function usePushNotifications(token: string) {
  const [state, setState] = useState<PushState>({
    supported: false,
    permission: 'default',
    subscribed: false,
    loading: false,
    error: null,
  });

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setState(s => ({ ...s, supported, permission: supported ? Notification.permission : 'denied' }));

    if (!supported) return;

    // Check if already subscribed
    navigator.serviceWorker.getRegistration('/sw.js').then(async reg => {
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) setState(s => ({ ...s, subscribed: true }));
    });

    // Listen for PUSH_SOUND messages from service worker
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SOUND') {
        playPushSound(!!event.data.urgent);
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  const subscribe = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const perm = await Notification.requestPermission();
      setState(s => ({ ...s, permission: perm }));
      if (perm !== 'granted') {
        setState(s => ({ ...s, loading: false, error: 'ההרשאה נדחתה על-ידי המשתמש' }));
        return;
      }

      const reg = await getRegistration();
      await navigator.serviceWorker.ready;

      const { data } = await axios.get(`${API}/push/vapid-public-key`, { headers });
      if (!data.publicKey) {
        setState(s => ({ ...s, loading: false, error: 'שרת: VAPID לא מוגדר — פנה למנהל מערכת' }));
        return;
      }

      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });

      // role is extracted server-side from JWT
      await axios.post(`${API}/push/subscribe`, sub.toJSON(), { headers });
      setState(s => ({ ...s, subscribed: true, loading: false }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message || 'שגיאה בהרשמה להתראות' }));
    }
  }, [token]);

  const unsubscribe = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await axios.delete(`${API}/push/subscribe`, { headers });
      setState(s => ({ ...s, subscribed: false, loading: false }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message || 'שגיאה בביטול ההתראות' }));
    }
  }, [token]);

  return { ...state, subscribe, unsubscribe };
}
