import { Routes, Route, Navigate } from 'react-router-dom'
import AuthGate from './components/AuthGate.jsx'
import Layout from './components/Layout.jsx'
import Contacts from './pages/Contacts.jsx'
import ContactDetail from './pages/ContactDetail.jsx'
import WhatsApp from './pages/WhatsApp.jsx'
import Meetings from './pages/Meetings.jsx'
import Settings from './pages/Settings.jsx'
import VoiceLog from './pages/VoiceLog.jsx'
import NotFound from './pages/NotFound.jsx'

function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/contacts" replace />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="/meetings" element={<Meetings />} />
          <Route path="/voice-log" element={<VoiceLog />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}

export default App
