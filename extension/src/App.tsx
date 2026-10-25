import Dashboard from './Dashboard'
import Popup from './Popup'

export default function App() {
  return document.body.dataset.view === 'dashboard' ? <Dashboard /> : <Popup />
}
