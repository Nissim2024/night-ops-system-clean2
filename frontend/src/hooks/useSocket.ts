import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// If API URL is relative (e.g. "/api"), socket.io connects to the origin root.
// If API URL is absolute (e.g. "http://localhost:3000"), socket.io connects there directly (dev mode).
const _apiUrl = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;
const SOCKET_URL = _apiUrl.startsWith('/') ? window.location.origin : _apiUrl;

interface UseSocketOptions {
  userId: string;
  fullName: string;
  teamId?: string;
  onTaskUpdated?: (task: any) => void;
  onTaskBlocked?: (task: any) => void;
  onGoDecision?: (decision: any) => void;
  onVersionUpdated?: (version: any) => void;
  onUserOnline?: (user: any) => void;
  onUserOffline?: (user: any) => void;
  onJoined?: (users: any[]) => void;
  onProposalCreated?: (data: { versionId: string }) => void;
  onTeamSubmitted?: (data: { versionId: string; teamName: string; submittedCount: number; totalTeams: number }) => void;
  onAllTeamsSubmitted?: (data: { versionId: string; totalTeams: number }) => void;
}

export const useSocket = (options: UseSocketOptions) => {
  const socketRef = useRef<Socket | null>(null);
  const optionsRef = useRef(options);

  // עדכון ה-ref בכל render בלי לגרום ל-reconnect
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const token = localStorage.getItem('deploycenter_token');
    const socket = io(SOCKET_URL, { transports: ['websocket'], auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('WebSocket connected:', socket.id);
      socket.emit('JOIN', { teamId: optionsRef.current.teamId });
    });

    socket.on('JOINED', (payload) => {
      optionsRef.current.onJoined?.(payload.connectedUsers ?? []);
    });

    socket.on('TASK_UPDATED', (task) => {
      optionsRef.current.onTaskUpdated?.(task);
    });

    socket.on('TASK_BLOCKED', (task) => {
      optionsRef.current.onTaskBlocked?.(task);
    });

    socket.on('GO_DECISION', (decision) => {
      optionsRef.current.onGoDecision?.(decision);
    });

    socket.on('VERSION_UPDATED', (version) => {
      optionsRef.current.onVersionUpdated?.(version);
    });

    socket.on('USER_ONLINE', (user) => {
      optionsRef.current.onUserOnline?.(user);
    });

    socket.on('USER_OFFLINE', (user) => {
      optionsRef.current.onUserOffline?.(user);
    });

    socket.on('PROPOSAL_CREATED', (data) => {
      optionsRef.current.onProposalCreated?.(data);
    });

    socket.on('TEAM_SUBMITTED', (data) => {
      optionsRef.current.onTeamSubmitted?.(data);
    });

    socket.on('ALL_TEAMS_SUBMITTED', (data) => {
      optionsRef.current.onAllTeamsSubmitted?.(data);
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const emit = useCallback((event: string, data: any) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { emit };
};