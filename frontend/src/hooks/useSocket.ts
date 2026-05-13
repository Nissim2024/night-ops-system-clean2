import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';

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
}

export const useSocket = (options: UseSocketOptions) => {
  const socketRef = useRef<Socket | null>(null);
  const optionsRef = useRef(options);

  // עדכון ה-ref בכל render בלי לגרום ל-reconnect
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('WebSocket connected:', socket.id);
      socket.emit('JOIN', {
        userId: optionsRef.current.userId,
        fullName: optionsRef.current.fullName,
        teamId: optionsRef.current.teamId,
      });
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