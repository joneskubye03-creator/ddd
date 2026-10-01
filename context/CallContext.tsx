'use client';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { auth, database } from '@/config/firebase';
import { onValue, ref } from 'firebase/database';
import ringtone from '@/assets/sounds/call.mp3';
import { useAudioPlayer } from 'expo-audio';
import * as fallback from '@/services/callService';
import type { CallCredentials } from '@/services/callService';

const service = Platform.OS === 'web' ? require('@/services/callService.web') : fallback;
type State = 'idle' | 'calling' | 'ringing' | 'in-call' | 'ended';
type Snapshot = { callId?: string; orderId?: string; channel?: string; direction?: 'incoming'|'outgoing'; peerName?: string; status?: string; expiresAt?: number; startedAt?: number };
type ContextValue = { callState: State; peerName: string; elapsedSeconds: number; formattedTime: string; isMuted: boolean; endedMessage: string; startCall: (orderId: string) => Promise<void>; answerCall: () => Promise<void>; declineCall: () => Promise<void>; endCall: () => Promise<void>; toggleMute: () => Promise<void> };
const CallContext = createContext<ContextValue | null>(null);
const terminal = new Set(['ended', 'declined', 'missed']);
const formatTime = (seconds: number) => seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}` : `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`;

export function CallProvider({ children }: { children: React.ReactNode }) {
  const player = useAudioPlayer(ringtone);
  const [callState, setCallState] = useState<State>('idle'); const [peerName, setPeerName] = useState(''); const [elapsedSeconds, setElapsedSeconds] = useState(0); const [isMuted, setIsMuted] = useState(false); const [endedMessage, setEndedMessage] = useState('');
  const current = useRef<Snapshot | null>(null); const sawCall = useRef(false); const sessionCall = useRef<string | null>(null); const connection = useRef<{ leave: () => Promise<void>; setMuted: (muted: boolean) => Promise<void> } | null>(null); const offset = useRef(0); const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRingtone = () => { try { player.pause(); } catch {} try { player.seekTo(0); } catch {} };
  const ring = () => { try { player.loop = true; player.play(); } catch {} };
  const token = async () => { if (!auth.currentUser) throw new Error('You must be signed in'); return auth.currentUser.getIdToken(); };
  const finish = (message: string) => { stopRingtone(); connection.current?.leave().catch(() => undefined); connection.current = null; setCallState(message ? 'ended' : 'idle'); setEndedMessage(message); if (message) { setTimeout(() => { setCallState('idle'); setEndedMessage(''); }, 2500); } };
  const join = async (data: any) => { connection.current = await service.joinChannel({ appId: data.appId, token: data.token, channel: data.channel, uid: data.uid } as CallCredentials); };
  useEffect(() => { if (Platform.OS === 'web') { const unlock = () => { try { player.play(); player.pause(); } catch {} }; window.addEventListener('pointerdown', unlock, { once: true }); return () => window.removeEventListener('pointerdown', unlock); } }, [player]);
  useEffect(() => { const uid = auth.currentUser?.uid; if (!uid) return; const unsubOffset = onValue(ref(database, '.info/serverTimeOffset'), s => { offset.current = s.val() || 0; }); const unsub = onValue(ref(database, `user_calls/${uid}`), async s => { const data = s.val() as Snapshot | null; if (!data?.callId) return; const now = Date.now() + offset.current; if (!sessionCall.current && (terminal.has(data.status || '') || (data.expiresAt && data.expiresAt <= now))) return; if (data.direction === 'incoming' && callState === 'in-call' && data.callId !== sessionCall.current) return; current.current = data; setPeerName(data.peerName || 'Rider'); if (data.callId !== sessionCall.current) { sessionCall.current = data.callId; sawCall.current = true; }
    if (data.status === 'ringing') { if (data.direction === 'incoming') { setCallState('ringing'); ring(); } else setCallState('calling'); if (data.expiresAt) { if (timeout.current) clearTimeout(timeout.current); timeout.current = setTimeout(() => { endCall('no_answer').catch(() => undefined); }, Math.max(0, data.expiresAt - now)); } }
    else if (data.status === 'active') { stopRingtone(); setCallState('in-call'); }
    else if (terminal.has(data.status || '') && sawCall.current) { finish(data.status === 'declined' ? 'Call declined' : data.status === 'missed' ? 'No answer' : `Call ended · ${formatTime(elapsedSeconds)}`); }
  }); return () => { unsub(); unsubOffset(); if (timeout.current) clearTimeout(timeout.current); }; }, [callState, elapsedSeconds]);
  useEffect(() => { if (callState !== 'in-call' || !current.current?.startedAt) return; const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() + offset.current - (current.current?.startedAt || Date.now())) / 1000))); tick(); const id = setInterval(tick, 1000); return () => clearInterval(id); }, [callState, current.current?.startedAt]);
  const startCall = async (orderId: string) => { try { const result = await service.startCallApi(orderId, await token()); current.current = { ...result, callId: result.callId, direction: 'outgoing', status: 'ringing' }; sessionCall.current = result.callId || null; setPeerName('Rider'); setCallState('calling'); await join(result); } catch (e: any) { finish(''); setEndedMessage(e.message || 'Unable to start call'); setCallState('ended'); setTimeout(() => { setCallState('idle'); setEndedMessage(''); }, 2500); } };
  const answerCall = async () => { if (!current.current?.callId) return; try { const result = await service.acceptCallApi(current.current.callId, await token()); stopRingtone(); await join(result); setCallState('in-call'); } catch (e: any) { finish(e.message || 'Unable to answer call'); } };
  const declineCall = async () => { if (!current.current?.callId) return; try { await service.declineCallApi(current.current.callId, await token()); } catch {} finish(''); };
  const endCall = async (reason?: string) => { if (current.current?.callId) { try { await service.endCallApi(current.current.callId, await token(), reason); } catch {} } finish(reason === 'no_answer' ? 'No answer' : `Call ended · ${formatTime(elapsedSeconds)}`); };
  const toggleMute = async () => { const next = !isMuted; await connection.current?.setMuted(next); setIsMuted(next); };
  const value = useMemo(() => ({ callState, peerName, elapsedSeconds, formattedTime: formatTime(elapsedSeconds), isMuted, endedMessage, startCall, answerCall, declineCall, endCall: () => endCall(), toggleMute }), [callState, peerName, elapsedSeconds, isMuted, endedMessage]);
  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
export function useCall() { const value = useContext(CallContext); if (!value) throw new Error('useCall must be used within CallProvider'); return value; }
