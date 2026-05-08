import './App.css'

import LandingPage from './LandingPage'

import Header from './Header'
import Footer from './Footer'
import Swiper from './Swiper'
import SettingsPage from './Settings'

import { Routes, Route, useLocation } from 'react-router-dom'




function App() {

  const location = useLocation()
  const isSwipePage = location.pathname === '/swipe'

  return (
    <>
      <Header/>
      {/*Adding routings for sub-webpages*/}

      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/swipe" element={<Swiper />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
      
      {!isSwipePage ? <Footer /> : null}
    </>
  )
}

export default App
