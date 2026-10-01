import AgoraRTC, { IAgoraRTCClient, IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng';
import { CallCredentials, CallApiResult, callApi } from './callService';

export async function joinChannel(credentials: CallCredentials, onRemoteAudio?: (user: unknown) => void) {
  const client: IAgoraRTCClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  let microphone: IMicrophoneAudioTrack | null = null;
  try {
    client.on('user-published', async (user, mediaType) => { await client.subscribe(user, mediaType); if (mediaType === 'audio') { user.audioTrack?.play(); onRemoteAudio?.(user); } });
    await client.join(credentials.appId, credentials.channel, credentials.token || null, credentials.uid);
    microphone = await AgoraRTC.createMicrophoneAudioTrack();
    await client.publish([microphone]);
    return { leave: async () => { microphone?.close(); await client.leave(); }, setMuted: async (muted: boolean) => { await microphone?.setEnabled(!muted); } };
  } catch (error) { microphone?.close(); await client.leave().catch(() => undefined); throw error; }
}
export const startCallApi = (orderId: string, token: string): Promise<CallApiResult> => callApi('/api/calls/start', { orderId }, token);
export const acceptCallApi = (callId: string, token: string): Promise<CallApiResult> => callApi('/api/calls/accept', { callId }, token);
export const declineCallApi = (callId: string, token: string): Promise<CallApiResult> => callApi('/api/calls/decline', { callId }, token);
export const endCallApi = (callId: string, token: string, reason?: string): Promise<CallApiResult> => callApi('/api/calls/end', { callId, ...(reason ? { reason } : {}) }, token);
