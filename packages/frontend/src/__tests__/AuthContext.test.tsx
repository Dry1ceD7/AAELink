import { act, renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

// Mock API
jest.mock('../services/api');
const mockedApi = api as jest.Mocked<typeof api>;

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should prevent infinite session checks', async () => {
    mockedApi.get.mockResolvedValue({ data: { user: null } });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Wait for initial session check
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // Should only call API once
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it('should handle successful login', async () => {
    const mockUser = {
      id: '1',
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'user' as const,
      locale: 'en',
      theme: 'light',
      seniorMode: false
    };

    mockedApi.post.mockResolvedValue({
      data: { ok: true, user: mockUser }
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      const success = await result.current.login('test@example.com', 'password');
      expect(success).toBe(true);
    });

    expect(result.current.user).toEqual(mockUser);
  });

  it('should handle failed login', async () => {
    mockedApi.post.mockRejectedValue(new Error('Login failed'));

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      const success = await result.current.login('test@example.com', 'wrongpassword');
      expect(success).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });
});
