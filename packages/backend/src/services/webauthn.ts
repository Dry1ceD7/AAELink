/**
 * WebAuthn Service
 * Handles passkey authentication with FIDO2/WebAuthn
 */

import type {
    AuthenticatorDevice,
    GenerateAuthenticationOptionsOpts,
    GenerateRegistrationOptionsOpts,
    PublicKeyCredentialDescriptorFuture
} from '@simplewebauthn/server';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';

interface WebAuthnConfig {
  rpName: string;
  rpID: string;
  origin: string;
}

class WebAuthnService {
  private config: WebAuthnConfig;
  private devices = new Map<string, AuthenticatorDevice[]>();

  constructor(config: WebAuthnConfig) {
    this.config = config;
  }

  public async generateRegistrationOptions(userId: string, userName: string, userDisplayName: string) {
    const userDevices = this.devices.get(userId) || [];

    const options: GenerateRegistrationOptionsOpts = {
      rpName: this.config.rpName,
      rpID: this.config.rpID,
      userID: userId,
      userName: userName,
      userDisplayName: userDisplayName,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'preferred',
        residentKey: 'preferred',
      },
      supportedAlgorithmIDs: [-7, -257], // ES256 and RS256
      excludeCredentials: userDevices.map(dev => ({
        id: dev.credentialID,
        type: 'public-key',
        transports: dev.transports,
      })),
    };

    return await generateRegistrationOptions(options);
  }

  public async verifyRegistrationResponse(
    userId: string,
    response: any,
    expectedChallenge: string
  ) {
    const userDevices = this.devices.get(userId) || [];

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpID,
    });

    if (verification.verified && verification.registrationInfo) {
      const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;

      const newDevice: AuthenticatorDevice = {
        credentialID,
        credentialPublicKey,
        counter,
        transports: response.response.transports || [],
      };

      userDevices.push(newDevice);
      this.devices.set(userId, userDevices);

      return {
        verified: true,
        credentialID: Buffer.from(credentialID).toString('base64url'),
      };
    }

    return { verified: false };
  }

  public async generateAuthenticationOptions(userId?: string) {
    const options: GenerateAuthenticationOptionsOpts = {
      rpID: this.config.rpID,
      allowCredentials: userId ? this.getUserCredentials(userId) : undefined,
      userVerification: 'preferred',
    };

    return await generateAuthenticationOptions(options);
  }

  public async verifyAuthenticationResponse(
    response: any,
    expectedChallenge: string,
    userId?: string
  ) {
    let userDevices: AuthenticatorDevice[] = [];

    if (userId) {
      userDevices = this.devices.get(userId) || [];
    } else {
      // Find user by credential ID
      const credentialId = Buffer.from(response.id, 'base64url');
      for (const [uid, devices] of this.devices.entries()) {
        if (devices.some(dev => dev.credentialID.equals(credentialId))) {
          userDevices = devices;
          userId = uid;
          break;
        }
      }
    }

    if (!userDevices.length || !userId) {
      return { verified: false, userId: null };
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpID,
      authenticator: userDevices.find(dev =>
        dev.credentialID.equals(Buffer.from(response.id, 'base64url'))
      ),
    });

    if (verification.verified) {
      // Update counter
      const device = userDevices.find(dev =>
        dev.credentialID.equals(Buffer.from(response.id, 'base64url'))
      );
      if (device) {
        device.counter = verification.authenticationInfo.newCounter;
      }

      return {
        verified: true,
        userId,
        credentialID: response.id,
      };
    }

    return { verified: false, userId: null };
  }

  private getUserCredentials(userId: string): PublicKeyCredentialDescriptorFuture[] {
    const userDevices = this.devices.get(userId) || [];
    return userDevices.map(dev => ({
      id: dev.credentialID,
      type: 'public-key' as const,
      transports: dev.transports,
    }));
  }

  public getUserDevices(userId: string): AuthenticatorDevice[] {
    return this.devices.get(userId) || [];
  }

  public removeDevice(userId: string, credentialId: string): boolean {
    const userDevices = this.devices.get(userId) || [];
    const credentialIdBuffer = Buffer.from(credentialId, 'base64url');

    const initialLength = userDevices.length;
    const filteredDevices = userDevices.filter(dev =>
      !dev.credentialID.equals(credentialIdBuffer)
    );

    if (filteredDevices.length < initialLength) {
      this.devices.set(userId, filteredDevices);
      return true;
    }

    return false;
  }
}

// Create singleton instance
const webauthnConfig = {
  rpName: process.env.RP_NAME || 'AAELink',
  rpID: process.env.RP_ID || 'localhost',
  origin: process.env.ORIGIN || 'http://localhost:5174',
};

export const webauthnService = new WebAuthnService(webauthnConfig);
export { WebAuthnService };
export type { WebAuthnConfig };

