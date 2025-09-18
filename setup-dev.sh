#!/bin/bash

# AAELink Development Setup Script
echo "🚀 Setting up AAELink development environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if required tools are installed
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed. Aborting." >&2; exit 1; }

# Install dependencies
echo "📦 Installing dependencies..."

# Backend dependencies
echo "Installing backend dependencies..."
cd aaelink-backend
npm install
cd ..

# Frontend dependencies
echo "Installing frontend dependencies..."
cd packages/frontend
npm install
cd ../..

# Enterprise backend dependencies
echo "Installing enterprise backend dependencies..."
cd aaelink-enterprise-backend
npm install
cd ..

# Start infrastructure services
echo "🐳 Starting infrastructure services..."
docker-compose -f docker-compose.dev.yml up -d postgres redis minio

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Setup database
echo "🗄️ Setting up database..."
cd aaelink-backend
npx prisma db push
npx prisma generate
cd ..

echo "✅ Development environment setup complete!"
echo ""
echo "To start the development servers:"
echo "  Backend:    cd aaelink-backend && npm run dev"
echo "  Frontend:   cd packages/frontend && npm run dev"
echo ""
echo "Or use Docker Compose:"
echo "  docker-compose -f docker-compose.dev.yml up"
echo ""
echo "Access points:"
echo "  Frontend:   http://localhost:5173"
echo "  Backend:    http://localhost:3001"
echo "  MinIO:      http://localhost:9001"
echo "  Database:   localhost:5432"