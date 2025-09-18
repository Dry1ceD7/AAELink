/**
 * Navigation Types for AAELink Mobile App
 * Version: 1.2.0
 */

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Messages: undefined;
  Calendar: undefined;
  Files: undefined;
  Profile: undefined;
};

export type DrawerParamList = {
  Main: undefined;
  Settings: undefined;
};

// Screen Props Types
export type LoginScreenProps = {
  navigation: any;
};

export type DashboardScreenProps = {
  navigation: any;
};

export type MessagesScreenProps = {
  navigation: any;
};

export type CalendarScreenProps = {
  navigation: any;
};

export type FilesScreenProps = {
  navigation: any;
};

export type ProfileScreenProps = {
  navigation: any;
};

export type SettingsScreenProps = {
  navigation: any;
};
