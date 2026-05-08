import geoPin from "./assets/geo_pin.svg";
import robot from "./assets/robot.svg";
import doomscrolling from "./assets/doomscrolling.svg";
import map from "./assets/map.svg";

import './about.css'

function About() {
  return (
    <section className="about">
      <div className="who-are-we">
        <h2>
          The problem with modern-day itinerary planning is that destinations always come with reviews and other social concerns. 
          In this environment, places that cater to the most people float on top.
        </h2>

        <h2>
          But that's not your intention. You want a trip that reflects your interests and will bring you happiness, your way. 
          Little places like
          these can be hard to find when the top results of "things to do in Vancouver" are constantly dominated by those few popular places.
          They can be good places, but this is not sufficient.
        </h2>

        <h1>... and so we made Voyago.</h1>

      </div>

      <div className="voyago-intro">

        <ul>
          <li>
            <img src={geoPin}/>
            <h1>Database of places</h1>
            <p>
              We routinely scan maps to create a large and updated database of
              destinations, restaurants, or casual locations in your
              destination.
            </p>
          </li>

          <li>
            <img src={robot}/>
            <h1>LLM-filtering</h1>
            <p>
              Our backend LLMs do not care about what others think. They filter
              info about destinations so that you see their functions and judge
              it for yourself.
            </p>
          </li>

          <li>
            <img src={doomscrolling}/>
            <h1>Doomscrolling</h1>
            <p>
              What better way for our AI to learn about you than doomscrolling?
              Doomscroll recommended destinations and rate them out of 10, or
              directly place them on your itinerary.
            </p>
          </li>

          <li>
            <img src={map}/>
            <h1>Itinerary creation</h1>
            <p>
              You can build your own itinerary, or you can use our AI agent
              with full context of your preferences and constraints.
            </p>
          </li>
        </ul>

      </div>
    </section>

  );

}

export default About;
