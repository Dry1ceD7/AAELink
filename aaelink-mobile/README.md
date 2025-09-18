# AAELink Enterprise Mobile

React Native + Expo mobile application for AAELink Enterprise workspace platform.

## Features

- **Cross-Platform**: iOS, Android, and Web support
- **Offline-First**: Works without internet connection
- **Real-time Sync**: Automatic data synchronization when online
- **Modern UI**: Discord + Telegram inspired interface
- **Secure**: End-to-end encryption and secure storage
- **PWA Ready**: Progressive Web App capabilities

## Tech Stack

- **React Native** with Expo
- **TypeScript** for type safety
- **React Navigation** for navigation
- **React Native Paper** for UI components
- **Zustand** for state management
- **TanStack Query** for data fetching
- **AsyncStorage** for local storage
- **Expo SecureStore** for secure data
- **NetInfo** for network status

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn
- Expo CLI
- iOS Simulator (for iOS development)
- Android Studio (for Android development)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm start
```

3. Run on specific platforms:
```bash
# iOS
npm run ios

# Android
npm run android

# Web
npm run web
```

## Project Structure

```
src/
├── components/          # Reusable components
├── context/            # React contexts
├── screens/            # Screen components
├── types/              # TypeScript types
└── utils/              # Utility functions
```

## Features Overview

### Authentication
- Secure login with email/password
- Demo credentials: admin@aae.co.th / 12345678
- JWT token management
- Secure storage

### Dashboard
- Quick stats overview
- Recent activity feed
- Quick action buttons
- Real-time status indicators

### Messages
- Channel-based messaging
- Offline message support
- Real-time sync
- Message history

### Calendar
- Event management
- Multiple view modes (day/week/month)
- Offline event storage
- Meeting scheduling

### Files
- File upload/download
- Offline file access
- File sharing
- Multiple file types support

### Profile
- User profile management
- Account settings
- Connection status
- Offline data management

### Settings
- Theme customization
- Notification preferences
- Sync settings
- Cache management

## Offline Support

The app is designed to work offline with the following features:

- **Local Storage**: All data is stored locally using AsyncStorage
- **Background Sync**: Automatic sync when connection is restored
- **Conflict Resolution**: Smart conflict resolution for data conflicts
- **Offline Indicators**: Clear visual indicators for offline status
- **Queue Management**: Pending actions are queued for later sync

## Security

- **Secure Storage**: Sensitive data stored in Expo SecureStore
- **JWT Tokens**: Secure authentication tokens
- **Data Encryption**: All data encrypted at rest
- **Network Security**: HTTPS-only communication

## Development

### Code Style

- TypeScript for type safety
- ESLint for code linting
- Prettier for code formatting
- Consistent naming conventions

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Building

```bash
# Build for production
npm run build

# Build for specific platforms
expo build:ios
expo build:android
```

## Deployment

### iOS App Store

1. Build the app:
```bash
expo build:ios
```

2. Submit to App Store Connect

### Google Play Store

1. Build the app:
```bash
expo build:android
```

2. Upload to Google Play Console

### Web Deployment

1. Build for web:
```bash
expo build:web
```

2. Deploy to your hosting provider

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

© 2024 Advanced ID Asia Engineering Co.,Ltd. All rights reserved.

## Support

For support and questions, please contact the development team.
