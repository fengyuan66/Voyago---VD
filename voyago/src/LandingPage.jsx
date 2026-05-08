import Hero from "./Hero";
import Destinations from "./Destinations";
import About from "./About";
import HeroTransition from "./HeroTransition";

function LandingPage(){
    return(
        <>
            <Hero />
            <HeroTransition />
            <About/>
        </>
    )
}

export default LandingPage