import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Contacts from './pages/Contacts.jsx'
import ContactDetail from './pages/ContactDetail.jsx'
import Mentors from './pages/Mentors.jsx'
import ImportCSV from './pages/ImportCSV.jsx'
import WhatsApp from './pages/WhatsApp.jsx'
import Meetings from './pages/Meetings.jsx'
import Settings from './pages/Settings.jsx'
import BookMeeting from './pages/BookMeeting.jsx'
import MondayTasks from './pages/MondayTasks.jsx'
import VoiceLog from './pages/VoiceLog.jsx'
import NotFound from './pages/NotFound.jsx'

function App() {
  return (
    <Routes>
      {/* Public route - no layout */}
      <Route path="/book/:contactId" element={<BookMeeting />} />

      {/* Admin routes with layout */}
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/contacts/:id" element={<ContactDetail />} />
        <Route path="/mentors" element={<Mentors />} />
        <Route path="/import" element={<ImportCSV />} />
        <Route path="/whatsapp" element={<WhatsApp />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/voice-log" element={<VoiceLog />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/monday" element={<MondayTasks />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default App
