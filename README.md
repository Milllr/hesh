<a href="https://hesh.ca"><img src=".github/readme/hesh.gif" width="100%" alt="The HESH Ontario licence plate, then skiers and snowboarders riding the backyard rail at a jam"></a>

# hesh.ca

an 8' tall, 40' long wooden ski ramp and rail in our backyard near Cherryhill Mall, London Ontario.

<p>
<img src=".github/readme/slide-what.jpg" width="49%" alt="A skier on the rail with the crowd and the house behind. A free railjam in a student backyard."> <img src=".github/readme/slide-size.jpg" width="49%" alt="The snow covered ramp with the crowd by the house. 8 ft tall. 40 ft long.">
<img src=".github/readme/slide-history.jpg" width="49%" alt="Since 2021: a rail in the back of a car in Toronto, the build in 2024, the first jams in 2025, Snow Day in 2026"> <img src=".github/readme/slide-sixty.jpg" width="49%" alt="60+ came to Snow Day last winter, sponsored by Red Bull, with photos of the crowd around the firepit">
<img src=".github/readme/slide-hundred.jpg" width="49%" alt="100+ already signed up for the next jam"> <img src=".github/readme/slide-winter.jpg" width="49%" alt="Bigger this year: DJ, griddle and chef, firepit, marshmallows, trampoline, lights, prizes, snowmaker, every skill level">
</p>

<p>
<img src="public/img/redbull/hero-slide.jpg" width="32%" alt="A skier in the air over the rail with the crowd watching"> <img src="public/img/redbull/green-shirt-slide.jpg" width="32%" alt="A skier sliding the rail past the crowd"> <img src="public/img/redbull/crew-redbull.jpg" width="32%" alt="Everyone at Snow Day in front of the house, under the Red Bull banner">
</p>

## Run it

The site needs four test values in a `.dev.vars` file first.

```
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
IP_SALT=local-dev-only
ALLOW_TEST_KEYS=1
ADMIN_PASSWORD=any-local-password
```

```
npx wrangler d1 migrations apply hesh-signups --local
npx wrangler pages dev
```

[hesh.ca](https://hesh.ca) · [@backyardrail](https://instagram.com/backyardrail)
