// ─────────────────────────────────────────────────────────────
//  EVERYTHING YOU NEED TO EDIT LIVES IN THIS FILE.
// ─────────────────────────────────────────────────────────────

export const CONFIG = {
  // Her name, the way it should appear in the banner and the song line.
  // Shown on the banner and in the song line. Could also be Cyrillic, e.g. "Саша".
  name: "Sasa",

  // ── The scenario, placed inside the 3D scan of the corridor + C306 ──
  // Positions are [x, y, z] in metres in the scan's coordinates (y is ignored).
  // Open tools/scan-map.html to click them into place and copy the result here.
  scenario: {
    model: "assets/scan/c306.glb", // 3.6 MB, 218k triangles
    modelLite: "assets/scan/c306-lite.glb", // 1.9 MB, used on low-memory phones or with ?lite
    walkmap: "assets/scan/walkmap", // .png + .json: where she can walk (generated from the scan)
    eyeHeight: 1.6,

    // Where she appears: the far end of the corridor, by the lockers
    start: [7.98, 0, -0.62],
    startHeading: 122, // degrees, facing down the corridor

    // The 3 clue images, floating along the way. Walk into one (or tap it) to collect it.
    // `color` tints its light beam, glow and minimap dot.
    clues: [
      {
        position: [3.91, 0, 1.19],
        element: "assets/elements/element1.png",
        color: "#e0524f", // red clock
        placeholder: { emoji: "🎈", color: "#e0524f" },
        hint: "The first one! Keep following the light down the corridor…",
      },
      {
        position: [-0.47, 0, 3.76],
        element: "assets/elements/element2.png",
        color: "#4cc94c", // green clock
        placeholder: { emoji: "🎁", color: "#4cc94c" },
        hint: "Two! Turn the corner, there's a door waiting for you…",
      },
      {
        position: [-1.91, 0, 1.31],
        element: "assets/elements/element3.png",
        color: "#d9a43a", // gold clock
        placeholder: { emoji: "⭐", color: "#d9a43a" },
        hint: "That's all three ✨ The door to C306 is open. Go in!",
      },
    ],

    // Stepping into this circle = she's in C306 → song + memories.
    room: {
      trigger: [-4.3, 0, -1.5],
      radius: 1.3,
      center: [-5.3, 0, -1.7], // middle of the room: the memories float around it
      photoRadius: 1.7,
      requireAllClues: true, // the room only opens once the 3 clues are collected

      // The yellow armchair (by the green desk, under the TV) is cut out of the scan and
      // replaced by a 3D capture (Gaussian splat) of someone sitting in it.
      couch: {
        splat: "assets/models/couch-sasa.spz", // cropped from Põhja-Tallinn.spz: chair + person only
        position: [-2.605, 0.62, -1.53], // where the capture's origin goes (its floor is 0.62 m below its origin)
        rotationY: -90, // degrees: the person faces into the room, chair back to the wall
        scale: 1,
        cutBox: [-3.15, -2.3, 0.04, 1.0, -1.98, -1.04], // scanned armchair to remove: x0,x1, y0,y1, z0,z1
      },
    },
  },

  // ── Extra scenes, opened with ?scene=<name> ──
  scenes: {
    // Made from a single dashcam photo: AI depth estimation, calibrated on the flat road.
    // Looks right from where the photo was taken; walking is limited to the first ~6 m of road,
    // beyond that one photo has no information about the sides and backs of things.
    street: {
      model: "assets/street/street.glb", // 0.65 MB
      walkmap: "assets/street/walkmap",
      eyeHeight: 1.7,
      start: [0, 0, -0.7], // where the dashcam was
      startHeading: 0,
      background: 0xbcd3e6, // soft sky, also fills what the photo never saw
      fog: null,
      far: 200,
      // Soundtrack while she's in the street (replaces the birthday song). Drop an mp3 here;
      // until then a synthesized suspense placeholder plays (drone, heartbeat, ticking clock).
      music: "assets/audio/street.mp3",

      // Something hunts her down the street: a flat photo that drifts towards her, very slowly.
      // If it touches her: jumpscare + the experience "crashes" (tap to reboot into C306).
      chaser: {
        image: null, // null = the drawn staring face (the look we kept). Or a photo path, e.g. "assets/chaser.jpg"
        sound: "assets/audio/chaser.mp3", // loops while it hunts her, louder the closer it gets
        reverb: 0.75, // how much eerie echo on that sound (0 = dry … 1 = drowning in it)
        jumpscare: "assets/jumpscare.jpg", // the face that fills the screen when it catches her (not shown while chasing)
        start: [-3.2, 0, -38], // far down the road
        delay: 4, // seconds of calm before it starts moving
        speed: 0.45, // metres per second: ~80 s to reach her if she just stands there
        height: 1.7, // how tall it is, in metres
        catchRadius: 0.8, // how close counts as touching
      },
      ui: {
        follow: "",
      },
    },
  },

  // Movement
  walk: {
    speed: 1.5, // m/s with the joystick
    stepLength: 0.7, // metres per real step (phone pedometer)
  },

  // The memory room. Add as many as you like (8–14 looks best).
  // `caption` is optional. Photos keep their own aspect ratio.
  photos: [
    { src: "assets/photos/01.jpg", caption: "" },
    // `portal`: tapping this photo takes her INTO it (the 3D scene of that name in `scenes`)
    { src: "assets/photos/02.jpg", caption: "", portal: "street" },
    { src: "assets/photos/03.jpg", caption: "" },
    { src: "assets/photos/04.jpg", caption: "" },
    { src: "assets/photos/05.jpg", caption: "" },
    { src: "assets/photos/06.jpg", caption: "" },
    { src: "assets/photos/07.jpg", caption: "" },
    { src: "assets/photos/08.jpg", caption: "" },
    { src: "assets/photos/09.jpg", caption: "" },
    { src: "assets/photos/10.jpg", caption: "" },
  ],

  // The Ukrainian birthday song. If this file is missing, a music-box
  // version of the melody is played instead so the moment never goes silent.
  song: "assets/audio/birthday.mp3",
  loopSong: false,

  // Shown on the 3D banner in the room.
  bannerTop: "З днем народження,",

  // Lyrics shown softly at the bottom while the song plays.
  // `{name}` is replaced with CONFIG.name. `at` = seconds from the start of the song.
  // The default timings match the built-in music-box melody; adjust them for your mp3.
  lyrics: [
    { at: 0.3, text: "З днем народження тебе," },
    { at: 4.05, text: "З днем народження тебе," },
    { at: 7.8, text: "З днем народження, {name}," },
    { at: 12.5, text: "З днем народження тебе!" },
  ],

  // UI text (feel free to translate).
  ui: {
    introButton: "Pay up!", // the only thing on screen before she starts
    loading: "Building the world…",
    follow: "Follow the light ✨",
    toRoom: "Now find room C306 ✨",
    notYet: (left) => `Find ${left} more before the door opens ✨`,
    progress: (found, total) => `${found} / ${total}`,
    roomHint: "Look around ✨ tap a photo to bring it closer",
    portalIn: "You're inside the photo ✨",
    portalBack: "↩ C306",
  },
};
