export type CallCredentials = { appId: string; token: string; channel: string; uid: string | number };
export type CallApiResult = { success: boolean; callId?: string; channel?: string; appId?: string; token?: string; uid?: string | number; expiresAt?: number; error?: string };

export async function joinChannel(_credentials: CallCredentials, _onRemoteAudio?: (user: unknown) => void): Promise<{ leave: () => Promise<void>; setMuted: (muted: boolean) => Promise<void> }> {
  throw new Error('Voice calls are only supported on web for now');
}
export async function startCallApi(_orderId: string, _token: string): Promise<CallApiResult> { throw new Error('Voice calls are only supported on web for now'); }
export async function acceptCallApi(_callId: string, _token: string): Promise<CallApiResult> { throw new Error('Voice calls are only supported on web for now'); }
export async function declineCallApi(_callId: string, _token: string): Promise<CallApiResult> { throw new Error('Voice calls are only supported on web for now'); }
export async function endCallApi(_callId: string, _token: string, _reason?: string): Promise<CallApiResult> { throw new Error('Voice calls are only supported on web for now'); }

export default {};

export type { CallCredentials as CallJoinCredentials };
export const API_BASE = 'https://aletwend-render-backend.onrender.com';
export async function callApi(path: string, body: Record<string, unknown>, token: string): Promise<CallApiResult> {
  const response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error(result.error || 'Call request failed');
  return result;
}

export const formatCallApi = { startCallApi, acceptCallApi, declineCallApi, endCallApi };
