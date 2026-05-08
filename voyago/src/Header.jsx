import {NavLink, useLocation} from 'react-router-dom'

/*if current header page is located in, e.g., the scroll page, customize it with CSS class X. In this case to become solid if it is the Scroll page */


function Header() {
    const location = useLocation();
    const isSwipePage = location.pathname === '/swipe'|| location.pathname === '/settings';
  return (
    <header className={`site-header ${isSwipePage ? 'site-header--solid' : ''}`}>
      <h1>Voyago</h1>
      <nav>
        <ul>
          <li>
            {/* Router link to homepage route "/" */}
            <NavLink to="/">Home</NavLink>
          </li>
          <li>
            <NavLink to="/swipe">Scroll</NavLink>
          </li>
          
          <li>
            <a href="#plan">Plan</a>
          </li>
          <li>
            <NavLink to="/settings">Settings</NavLink>
          </li>
        </ul>
      </nav>
    </header>
  )
}

/*Dynamic page-adding system for the header*/

export default Header

