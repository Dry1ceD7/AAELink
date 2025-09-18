import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = loginSchema.parse(body);

    // Mock authentication - replace with real implementation
    const validCredentials = [
      { username: 'admin', password: '12345678' },
      { username: 'admin@aae.co.th', password: '12345678' },
      { username: 'test', password: 'test123' },
    ];

    const isValid = validCredentials.some(
      cred => (cred.username === username || cred.username === username) && cred.password === password
    );

    if (!isValid) {
      return NextResponse.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Generate JWT token (in production, use a proper JWT library)
    const token = Buffer.from(JSON.stringify({
      userId: '1',
      username: username,
      role: 'admin',
      exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    })).toString('base64');

    // Set secure HTTP-only cookie
    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: '1',
        username: username,
        email: username.includes('@') ? username : `${username}@aae.co.th`,
        role: 'admin',
        avatar: username.charAt(0).toUpperCase(),
      }
    });

    // Set secure cookie
    response.cookies.set('aaelink-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60, // 24 hours
      path: '/',
    });

    return response;

  } catch (error) {
    console.error('Login error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: 'Invalid input data', errors: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
