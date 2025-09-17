#!/usr/bin/env node

const https = require('http');

async function testFunctionality() {
  console.log('🧪 Testing AAELink Functionality...\n');

  // Test 1: Backend Health Check
  console.log('1. Testing Backend Health Check...');
  try {
    const healthResponse = await fetch('http://localhost:3002/health');
    const healthData = await healthResponse.json();
    console.log('✅ Backend is healthy:', healthData.status);
  } catch (error) {
    console.log('❌ Backend health check failed:', error.message);
    return;
  }

  // Test 2: Frontend Accessibility
  console.log('\n2. Testing Frontend Accessibility...');
  try {
    const frontendResponse = await fetch('http://localhost:5173');
    const frontendHtml = await frontendResponse.text();
    if (frontendHtml.includes('AAELink') && frontendHtml.includes('main.tsx')) {
      console.log('✅ Frontend is accessible and loading React app');
    } else {
      console.log('❌ Frontend not loading properly');
    }
  } catch (error) {
    console.log('❌ Frontend accessibility test failed:', error.message);
  }

  // Test 3: Authentication API
  console.log('\n3. Testing Authentication API...');
  try {
    const loginResponse = await fetch('http://localhost:3002/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@aae.co.th',
        password: '12345678'
      })
    });
    const loginData = await loginResponse.json();
    if (loginData.ok && loginData.user) {
      console.log('✅ Login API working - User:', loginData.user.email);
    } else {
      console.log('❌ Login API failed:', loginData);
    }
  } catch (error) {
    console.log('❌ Authentication test failed:', error.message);
  }

  // Test 4: Session Management
  console.log('\n4. Testing Session Management...');
  try {
    const sessionResponse = await fetch('http://localhost:3002/api/auth/session');
    const sessionData = await sessionResponse.json();
    if (sessionData.error === 'Not authenticated') {
      console.log('✅ Session management working (correctly returns not authenticated)');
    } else {
      console.log('❌ Session management issue:', sessionData);
    }
  } catch (error) {
    console.log('❌ Session management test failed:', error.message);
  }

  console.log('\n🎉 Functionality test completed!');
  console.log('\n📋 Summary:');
  console.log('- Backend: http://localhost:3002');
  console.log('- Frontend: http://localhost:5173');
  console.log('- Login: admin@aae.co.th / 12345678');
  console.log('\n🚀 You can now open http://localhost:5173 in your browser!');
}

testFunctionality().catch(console.error);
