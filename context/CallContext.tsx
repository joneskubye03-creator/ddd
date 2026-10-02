'use client';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { auth, database } from '@/config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import ringtone from '@/assets/sounds/call.mp3';
import { useAudioPlayer } from 'expo-audio';
import type { CallCredentials } from '@/services/callApi';

const service = Platform.OS === 'web' ? require('@/services/callService.web') : require('@/services/callService');
type State = 'idle' | 'calling' | 'ringing' | 'in-call' | 'ended';
type Snapshot = { callId?: string; orderId?: string; channel?: string; direction?: 'incoming' | 'outgoing'; peerName?: string; status?: string; expiresAt?: number; startedAt?: number; appId?: string; token?: string; uid?: string | number };
type Connection = { leave: () => Promise<void>; setMuted: (muted: boolean) => Promise<void> };
type ContextValue = { callState: State; peerName: string; elapsedSeconds: number; formattedTime: string; isMuted: boolean; endedMessage: string; startCall: (orderId: string) => Promise<void>; answerCall: () => Promise<void>; declineCall: () => Promise<void>; endCall: () => Promise<void>; toggleMute: () => Promise<void> };
const CallContext = createContext<ContextValue | null>(null);
const terminal = new Set(['ended', 'declined', 'missed']);
const formatTime = (seconds: number) => seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export function CallProvider({ children }: { children: React.ReactNode }) {
  const player = useAudioPlayer(ringtone);
  const [callState, setCallState] = useState<State>('idle');
  const [peerName, setPeerName] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [endedMessage, setEndedMessage] = useState('');
  const callStateRef = useRef(callState); const elapsedRef = useRef(elapsedSeconds); const currentRef = useRef<Snapshot | null>(null); const endCallRef = useRef<(reason?: string) => Promise<void>>(async () => undefined);
  const sessionCall = useRef<string | null>(null); const connectionRef = useRef<Connection | null>(null); const offsetRef = useRef(0); const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); const timerRef = useRef<ReturnType<typeof setInterval> | null>(null); const sawCall = useRef(false); const ringStateRef = useRef(false);
  callStateRef.current = callState; elapsedRef.current = elapsedSeconds;

  const stopRingtone = () => { try { player.pause(); } catch {} try { player.seekTo(0); } catch {} ringStateRef.current = false; };
  const startRingtone = () => { try { player.loop = true; } catch {} try { player.play(); } catch {} ringStateRef.current = true; };
  const leaveConnection = async () => { const active = connectionRef.current; connectionRef.current = null; if (active) await active.leave().catch(() => undefined); };
  const token = async () => { const user = auth.currentUser; if (!user) throw new Error('You must be signed in'); return user.getIdToken(); };
  const showEnded = (message: string) => { setEndedMessage(message); setCallState('ended'); setTimeout(() => { setCallState('idle'); setEndedMessage(''); }, 2500); };
  const join = async (data: Snapshot) => { connectionRef.current = await service.joinChannel({ appId: data.appId, token: data.token, channel: data.channel, uid: data.uid } as CallCredentials); };

  const endCall = async (reason?: string) => {
    const callId = currentRef.current?.callId;
    if (callId) { try { await service.endCallApi(callId, await token(), reason); } catch {} }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    stopRingtone(); await leaveConnection();
    if (reason === 'no_answer') showEnded('No answer'); else showEnded(`Call ended · ${formatTime(elapsedRef.current)}`);
  };
  endCallRef.current = endCall;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const unlock = () => { try { player.play(); } catch {} try { player.pause(); } catch {} };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [player]);

  useEffect(() => {
    let unsubscribeCall: (() => void) | undefined; let unsubscribeOffset: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeCall?.(); unsubscribeOffset?.(); unsubscribeCall = undefined; unsubscribeOffset = undefined;
      if (!user) { currentRef.current = null; sessionCall.current = null; sawCall.current = false; stopRingtone(); void leaveConnection(); return; }
      unsubscribeOffset = onValue(ref(database, '.info/serverTimeOffset'), (snapshot) => { offsetRef.current = snapshot.val() || 0; });
      unsubscribeCall = onValue(ref(database, `user_calls/${user.uid}`), (snapshot) => {
        const data = snapshot.val() as Snapshot | null; if (!data?.callId) return;
        const now = Date.now() + offsetRef.current;
        if (!sessionCall.current && (terminal.has(data.status || '') || (data.expiresAt !== undefined && data.expiresAt <= now))) return;
        if (data.direction === 'incoming' && (callStateRef.current === 'calling' || callStateRef.current === 'in-call') && data.callId !== sessionCall.current) return;
        const isNew = data.callId !== sessionCall.current; currentRef.current = data; setPeerName(data.peerName || 'Rider');
        if (isNew) { sessionCall.current = data.callId; sawCall.current = true; }
        if (data.status === 'ringing') {
          if (data.expiresAt !== undefined && data.expiresAt <= now) { void endCallRef.current('no_answer'); return; }
          if (data.direction === 'incoming') { if (callStateRef.current !== 'ringing') setCallState('ringing'); if (!ringStateRef.current) startRingtone(); }
          else setCallState('calling');
          if (data.expiresAt) { if (timeoutRef.current) clearTimeout(timeoutRef.current); timeoutRef.current = setTimeout(() => void endCallRef.current('no_answer'), Math.max(0, data.expiresAt! - now)); }
        } else if (data.status === 'active') {
          stopRingtone(); setCallState('in-call');
          if (data.startedAt) { const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() + offsetRef.current - data.startedAt!) / 1000))); tick(); if (timerRef.current) clearInterval(timerRef.current); timerRef.current = setInterval(tick, 1000); }
        } else if (terminal.has(data.status || '') && sawCall.current) {
          stopRingtone(); void leaveConnection(); showEnded(data.status === 'declined' ? 'Call declined' : data.status === 'missed' ? 'No answer' : `Call ended · ${formatTime(elapsedRef.current)}`);
        }
      });
    });
    return () => { unsubscribeAuth(); unsubscribeCall?.(); unsubscribeOffset?.(); if (timeoutRef.current) clearTimeout(timeoutRef.current); if (timerRef.current) clearInterval(timerRef.current); stopRingtone(); void leaveConnection(); };
  }, [player]);

  const startCall = async (orderId: string) => {
    setPeerName('Rider'); setCallState('calling');
    let callId: string | undefined;
    try { const result = await service.startCallApi(orderId, await token()); callId = result.callId; currentRef.current = { ...result, callId, orderId, direction: 'outgoing', status: 'ringing' }; sessionCall.current = callId || null; await join(result); }
    catch (error: any) {
      if (callId) { try { await service.endCallApi(callId, await token()); } catch {} }
      await leaveConnection(); stopRingtone(); const message = error?.name === 'NotAllowedError' || /microphone|permission/i.test(error?.message || '') ? 'Microphone access is blocked. Allow it in the browser and try again.' : (error?.message || 'Unable to start call'); showEnded(message);
    }
  };
  const answerCall = async () => { const callId = currentRef.current?.callId; if (!callId) return; try { const result = await service.acceptCallApi(callId, await token()); stopRingtone(); await join({ ...currentRef.current, ...result }); setCallState('in-call'); } catch (error: any) { stopRingtone(); try { await service.declineCallApi(callId, await token()); } catch {} await leaveConnection(); showEnded(error?.message || 'Unable to answer call'); } };
  const declineCall = async () => { const callId = currentRef.current?.callId; if (callId) { try { await service.declineCallApi(callId, await token()); } catch {} } stopRingtone(); await leaveConnection(); setCallState('idle'); };
  const toggleMute = async () => { const next = !isMuted; await connectionRef.current?.setMuted(next); setIsMuted(next); };
  const value = useMemo(() => ({ callState, peerName, elapsedSeconds, formattedTime: formatTime(elapsedSeconds), isMuted, endedMessage, startCall, answerCall, declineCall, endCall: () => endCall(), toggleMute }), [callState, peerName, elapsedSeconds, isMuted, endedMessage]);
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
export function useCall() { const value = useContext(CallContext); if (!value) throw new Error('useCall must be used within CallProvider'); return value; }
