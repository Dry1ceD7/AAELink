import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface WebAuthnLoginProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

const WebAuthnLogin: React.FC<WebAuthnLoginProps> = ({ onSuccess, onError }) => {
  const [isLoading, setIsLoading] = useState(false);
  const { setUser } = useAuth();
  const { success, error } = useToast();

  const isWebAuthnSupported = () => {
    return !!(
      window.PublicKeyCredential &&
      window.navigator.credentials &&
      window.navigator.credentials.create &&
      window.navigator.credentials.get
    );
  };

  const handleWebAuthnLogin = async () => {
    if (!isWebAuthnSupported()) {
      const errorMsg = 'WebAuthn is not supported in this browser';
      error(errorMsg);
      onError?.(errorMsg);
      return;
    }

    setIsLoading(true);

    try {
      // Step 1: Get authentication options from server
      const optionsResponse = await fetch('/api/webauthn/login/begin', {
        method: 'GET',
        credentials: 'include'
      });

      if (!optionsResponse.ok) {
        throw new Error('Failed to get authentication options');
      }

      const options = await optionsResponse.json();

      // Step 2: Create credential
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(options.challenge),
          allowCredentials: options.allowCredentials?.map((cred: any) => ({
            ...cred,
            id: new Uint8Array(Buffer.from(cred.id, 'base64url'))
          })),
          userVerification: options.userVerification,
          timeout: options.timeout
        }
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Authentication was cancelled');
      }

      // Step 3: Send credential to server for verification
      const response = credential.response as AuthenticatorAssertionResponse;
      const verificationResponse = await fetch('/api/webauthn/login/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          response: {
            id: credential.id,
            rawId: Array.from(new Uint8Array(credential.rawId)),
            type: credential.type,
            response: {
              authenticatorData: Array.from(new Uint8Array(response.authenticatorData)),
              clientDataJSON: Array.from(new Uint8Array(response.clientDataJSON)),
              signature: Array.from(new Uint8Array(response.signature)),
              userHandle: response.userHandle ? Array.from(new Uint8Array(response.userHandle)) : null
            }
          },
          expectedChallenge: options.challenge
        })
      });

      if (!verificationResponse.ok) {
        throw new Error('Authentication verification failed');
      }

      const verification = await verificationResponse.json();

      if (verification.verified) {
        // Get user session
        const sessionResponse = await fetch('/api/auth/session', {
          credentials: 'include'
        });

        if (sessionResponse.ok) {
          const session = await sessionResponse.json();
          setUser(session.user);
          success('Login successful with passkey!');
          onSuccess?.();
        } else {
          throw new Error('Failed to get user session');
        }
      } else {
        throw new Error('Authentication failed');
      }
    } catch (err: any) {
      const errorMsg = err.message || 'WebAuthn authentication failed';
      console.error('WebAuthn login error:', err);
      error(errorMsg);
      onError?.(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleWebAuthnRegister = async () => {
    if (!isWebAuthnSupported()) {
      const errorMsg = 'WebAuthn is not supported in this browser';
      error(errorMsg);
      onError?.(errorMsg);
      return;
    }

    setIsLoading(true);

    try {
      const userId = `user_${Date.now()}`;
      const email = 'admin@aae.co.th';
      const displayName = 'Admin User';

      // Step 1: Get registration options from server
      const optionsResponse = await fetch(`/api/webauthn/register/begin/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, displayName })
      });

      if (!optionsResponse.ok) {
        throw new Error('Failed to get registration options');
      }

      const options = await optionsResponse.json();

      // Step 2: Create credential
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: new Uint8Array(options.challenge),
          rp: options.rp,
          user: {
            id: new Uint8Array(Buffer.from(options.user.id, 'base64url')),
            name: options.user.name,
            displayName: options.user.displayName
          },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout,
          attestation: options.attestation
        }
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Registration was cancelled');
      }

      // Step 3: Send credential to server for verification
      const response = credential.response as AuthenticatorAttestationResponse;
      const verificationResponse = await fetch(`/api/webauthn/register/complete/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          response: {
            id: credential.id,
            rawId: Array.from(new Uint8Array(credential.rawId)),
            type: credential.type,
            response: {
              attestationObject: Array.from(new Uint8Array(response.attestationObject)),
              clientDataJSON: Array.from(new Uint8Array(response.clientDataJSON))
            }
          },
          expectedChallenge: options.challenge
        })
      });

      if (!verificationResponse.ok) {
        throw new Error('Registration verification failed');
      }

      const verification = await verificationResponse.json();

      if (verification.verified) {
        success('Passkey registered successfully!');
        // Automatically try to login after registration
        await handleWebAuthnLogin();
      } else {
        throw new Error('Registration failed');
      }
    } catch (err: any) {
      const errorMsg = err.message || 'WebAuthn registration failed';
      console.error('WebAuthn registration error:', err);
      error(errorMsg);
      onError?.(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isWebAuthnSupported()) {
    return (
      <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
        <p className="text-yellow-800 dark:text-yellow-200 text-sm">
          WebAuthn is not supported in this browser. Please use email/password login.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-4xl mb-2">🔐</div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Passkey Authentication
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Use your device's built-in security features
        </p>
      </div>

      <div className="space-y-2">
        <button
          onClick={handleWebAuthnLogin}
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
              Authenticating...
            </span>
          ) : (
            'Sign in with Passkey'
          )}
        </button>

        <button
          onClick={handleWebAuthnRegister}
          disabled={isLoading}
          className="w-full bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 text-white py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
              Registering...
            </span>
          ) : (
            'Register New Passkey'
          )}
        </button>
      </div>

      <div className="text-center">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Passkeys use your device's biometric authentication or PIN
        </p>
      </div>
    </div>
  );
};

export default WebAuthnLogin;
