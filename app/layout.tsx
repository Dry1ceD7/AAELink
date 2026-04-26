import './styles.css'

export const metadata = {
  title: 'AAELink',
  description: 'Clean Mattermost-powered enterprise chat.'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
