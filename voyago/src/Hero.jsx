import heroImage from './assets/hero.svg'

import './hero.css'

function Hero(){
    return (
        <section className="hero">
            <div className="hero-content">
                <h1>Welcome to Voyago</h1>
                <p>Plan your next trip around You</p>
            </div>
            <div className="hero-image">
                <img src={heroImage}/>
            </div>
            <div className="hero-actions">
                <button className="primary-btn">Get Started</button>
            </div>
        </section>
    );
}

export default Hero
