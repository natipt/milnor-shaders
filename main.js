// Import three.js from CDN
import * as THREE from 'https://unpkg.com/three@0.155.0/build/three.module.js';

// Create WebGL renderer and bind to canvas
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas') });
renderer.setSize(window.innerWidth, window.innerHeight);

// Basic scene setup
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

// Shader uniforms
const uniforms = {
  epsilon: { value: new THREE.Vector2(0.1, 0.0) }, // complex constant epsilon = 0.1
  theta: { value: Math.PI }, // initial angle for Milnor fiber
  time: { value: 0.0 }, // animated time
  zoom: {value: 1.0}
};

// Parse user poly
// function parsePolynomial(expr) {
//   expr = expr.replace(/\s+/g, '');
//   const terms = expr.match(/[+-]?[^+-]+/g); // separate by +/- terms

//   if (!terms) return 'vec2(0.0, 0.0)';

//   let glsl = terms.map(term => {
//     if (/^[+-]?\d*\.?\d*$/.test(term)) {
//       // real constant
//       return `vec2(${parseFloat(term)}, 0.0)`;
//     }

//     const match = term.match(/^([+-]?[\d\.]*)?(x|y)(\^(\d+))?$/);
//     if (match) {
//       let [, coeff, variable, , power] = match;
//       coeff = coeff || '+1';
//       if (coeff === '+') coeff = '1';
//       if (coeff === '-') coeff = '-1';
//       power = parseInt(power || '1');

//       let base = variable;
//       for (let i = 1; i < power; i++) {
//         base = `complexMul(${base}, ${variable})`;
//       }
//       return `complexMul(vec2(${coeff}, 0.0), ${base})`;
//     }

//     if (term.includes('x') && term.includes('y')) {
//       return `complexMul(${term.replace(/([xy])/g, 'vec2($1, 0.0)')})`;
//     }

//     return `vec2(0.0) /* unparsed: ${term} */`;
//   });
//   console.log(glsl.join(' + '));
//   return glsl.join(' + ');
// }
function parsePolynomial(expr) {
  expr = expr.replace(/\s+/g, '');
  const terms = expr.match(/[+-]?[^+-]+/g); // separate by +/- terms

  if (!terms) return 'vec2(0.0, 0.0)';

  let glsl = terms.map(term => {
    // Match constant or terms involving x and/or y
    const match = term.match(/^([+-]?[\d\.]*)?((x(\^\d+)?)?(y(\^\d+)?)?|((y(\^\d+)?)?(x(\^\d+)?)))$/);

    if (!match) {
      console.log(`vec2(0.0) /* unparsed: ${term} */`);
      return `vec2(0.0) /* unparsed: ${term} */`;
    }

    let coeff = match[1] || '+1';
    if (coeff === '+') coeff = '1';
    if (coeff === '-') coeff = '-1';

    const xPart = term.match(/x(\^(\d+))?/);
    const yPart = term.match(/y(\^(\d+))?/);

    const xPow = xPart ? parseInt(xPart[2] || '1') : 0;
    const yPow = yPart ? parseInt(yPart[2] || '1') : 0;

    let result = `vec2(${parseFloat(coeff)}, 0.0)`;

    for (let i = 0; i < xPow; i++) {
      result = `complexMul(${result}, x)`;
    }

    for (let i = 0; i < yPow; i++) {
      result = `complexMul(${result}, y)`;
    }

    return result;
  });

  return glsl.join(' + ');
}

  

function buildGLSLFunction(expr) {
    const body = parsePolynomial(expr);
    return `
        vec2 f(vec2 x, vec2 y) {
            return ${body};
        }
        `;
}

let baseShaderTemplate = `
    precision highp float;
    varying vec2 vUv;
    uniform vec2 epsilon;
    uniform float theta;
    uniform float time;
    uniform vec2 resolution;
    uniform mat3 cameraMatrix;
    uniform float zoom;


    // Constants for raymarching
    #define MAX_STEPS 1000
    // #define SURFACE_THRESHOLD 0.01
    #define SURFACE_THRESHOLD 0.01
    #define KNOT_THRESHOLD 0.1
    #define MAX_DIST 10.0
    #define NEAR_CLIP 0.4

    vec4 stereographicInverse(vec3 p) {
      float denom = 1.0 + dot(p, p);
      float xr = 2.0 * p.x / denom;
      float xi = 2.0 * p.y / denom;
      float yr = 2.0 * p.z / denom;
      float yi = (dot(p, p) - 1.0) / denom;
      return vec4(xr, xi, yr, yi);
    }

    vec2 complexAdd(vec2 a, vec2 b) {
      return a + b;
    }

    vec2 complexMul(vec2 a, vec2 b) {
      return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
    }

    vec2 complexPow3(vec2 z) {
      return complexMul(z, complexMul(z, z));
    }

    float arg(vec2 z) {
      return atan(z.y, z.x);
    }
    
    // REPLACE_F_FUNCTION
    
    float fiberFunction(vec3 p) {
      vec4 s = stereographicInverse(p);
      vec2 x = s.xy;
      vec2 y = s.zw;
      float norm = dot(x, x) + dot(y, y);
      if (abs(norm - 1.0) > 0.1) return 1.0;
      vec2 fxy = f(x, y); // Call dynamically defined function
      float mag = length(fxy);
      if (mag < 1e-10) return 1.0; // avoid division by zero near the knot
      vec2 fhat = fxy / mag; // normalize f to unit circle
      // float pi = 3.1415926535897932384626433832795028841971693993751058209749445923078164062;
      float pi = 3.14159265;

      // Rotate fxy by e^{-iθ}
      // Rotate fxy by e^{-iθ}
      vec2 rotator = vec2(cos(theta), -sin(theta));
      vec2 aligned = complexMul(fxy, rotator);
  
      // Only consider aligned vectors that point in positive real direction
      if (aligned.x <= 0.0) return 1.0;
  
      // Check if imaginary part is close to 0
      return abs(aligned.y);

      // return length(vec2(sin(arg(10.0 * fxy)), cos(arg(10.0 * fxy))) - vec2(cos(theta), sin(theta)));
      // float angleDiff = mod(arg(fxy) - theta + 3.14159265, 6.2831853) - 3.14159265;
      // return abs(angleDiff);
      // float diff = length(fhat - vec2(cos(theta), sin(theta)));
      // float diff = mod(arg(fhat) - theta + pi, 2.0 * pi) - pi;
      // float diff = mod(arg(fhat) - theta, 2.0 * pi);
      // return diff; // small only near the fiber
      // return cos(diff);
    }
      

    float knotFunction(vec3 p) {
      vec4 s = stereographicInverse(p);
      vec2 x = s.xy;
      vec2 y = s.zw;
      float norm = dot(x, x) + dot(y, y);
      if (abs(norm - 1.0) > 0.1) return 1.0;
      vec2 fxy = f(x,y);
      return length(fxy);
    }

    vec3 getNormal(vec3 p) {
      float h = 0.001;
      float dx = fiberFunction(p + vec3(h,0,0)) - fiberFunction(p - vec3(h,0,0));
      float dy = fiberFunction(p + vec3(0,h,0)) - fiberFunction(p - vec3(0,h,0));
      float dz = fiberFunction(p + vec3(0,0,h)) - fiberFunction(p - vec3(0,0,h));
      return normalize(vec3(dx, dy, dz));
    }

    vec3 getKnotNormal(vec3 p) {
      float h = 0.001;
      float dx = knotFunction(p + vec3(h,0,0)) - knotFunction(p - vec3(h,0,0));
      float dy = knotFunction(p + vec3(0,h,0)) - knotFunction(p - vec3(0,h,0));
      float dz = knotFunction(p + vec3(0,0,h)) - knotFunction(p - vec3(0,0,h));
      return normalize(vec3(dx, dy, dz));
    }
  
    vec3 raymarch(vec3 ro, vec3 rd) {
      float t = 0.0;
      vec3 accumulatedColor = vec3(0.0);
      float accumulatedAlpha = 0.0;
      
      for (int i = 0; i < MAX_STEPS && accumulatedAlpha < 1.0; i++) {
          vec3 p = ro + t * rd;
          float d = fiberFunction(p);
          float k = knotFunction(p);
      
          float knotRadius = clamp(KNOT_THRESHOLD + 0.03 / (1.0 + 5.0 * dot(p, p)), 0.04, 0.08);
      
          if (k < knotRadius) {
              vec3 kn = getKnotNormal(p);
              vec3 color = vec3(1.0);
              return color;
          }
    
          if (d < SURFACE_THRESHOLD) {
              // if (d < 0.0) {
              //   return vec3(1.0,0,0);
              // }
              vec3 normal = getNormal(p);
              vec3 lightDir = normalize(vec3(1.0, 1.0, 2.0));
              vec3 viewDir = normalize(-rd);
              vec3 halfVec = normalize(lightDir + viewDir);
              float spec = pow(max(dot(normal, halfVec), 0.0), 64.0);
              vec3 base = 0.5 + 0.5 * normal;
              vec3 color = base + 0.1 * vec3(1.0) + vec3(1.0) * spec;
              
              // Make alpha depend on t: close to screen = low opacity
              float alpha = 1.0;

              if (t < 0.6) {
                  alpha = smoothstep(0.3, 0.6, t) * 0.7;
                  if (alpha < 0.01) {
                      t += 0.01; // skip this hit entirely
                      continue;
                  }
              }
      
              // Blend color into accumulator
              accumulatedColor = mix(accumulatedColor, color, alpha * (1.0 - accumulatedAlpha));
              accumulatedAlpha += alpha * (1.0 - accumulatedAlpha);
          }
    
          if (t > MAX_DIST) break;
      
          //   reduce stepsize near the origin
          //   float stepSize = clamp(min(abs(d), k), 0.002, 0.05);
          // float stepSize = clamp(min(abs(d), k), 0.001, 0.05); // tighter min
          float stepSize = clamp(min(abs(d), k), 0.0001, 0.005);


          t += stepSize;
      }
    
      return accumulatedColor;
    }

    void main() {
      vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
      vec2 uv = (vUv * 2.0 - 1.0) * aspect * 1.5 / zoom; // multiply by something smaller to make it bigger

      vec3 ro = cameraMatrix * vec3(0.0, 0.0, 3.0);
      vec3 rd = normalize(cameraMatrix * vec3(uv, -1.0));  
      
      // // orthographic
      // vec3 ro = cameraMatrix * vec3(uv, 3.0);     // ray origin varies with screen
      // vec3 rd = normalize(cameraMatrix * vec3(0.0, 0.0, -1.0)); // fixed direction

      vec3 color = raymarch(ro, rd);
      gl_FragColor = vec4(color, 1.0);
    }
  `

const userExpr = document.getElementById('polyInput').value;
const fFunction = buildGLSLFunction(userExpr);

const fullShader = baseShaderTemplate.replace('// REPLACE_F_FUNCTION', fFunction);

// Create a full screen quad using a shader material
const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: `
    varying vec2 vUv; // Pass UV coordinates to fragment shader
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0); // Standard vertex transformation
    }
  `,
  fragmentShader: fullShader
});

material.fragmentShader = fullShader;
material.needsUpdate = true;

const geometry = new THREE.PlaneGeometry(2, 2);
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

uniforms.cameraMatrix = { value: new THREE.Matrix3() };

// let yaw = 0.0, pitch = 0.0;
let yaw = 0.54, pitch = -0.285;
let isDragging = false, lastX = 0, lastY = 0;

canvas.addEventListener('mousedown', e => {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('mousemove', e => {
    if (isDragging) {
        yaw += (e.clientX - lastX) * 0.005;
        pitch += (e.clientY - lastY) * 0.005;
        lastX = e.clientX;
        lastY = e.clientY;
    }
});

// MOBILE SCROLLING
canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isDragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    }
});
  
canvas.addEventListener('touchmove', e => {
    if (isDragging && e.touches.length === 1) {
        const touch = e.touches[0];
        yaw += (touch.clientX - lastX) * 0.005;
        pitch += (touch.clientY - lastY) * 0.005;
        lastX = touch.clientX;
        lastY = touch.clientY;
    }
});
  
canvas.addEventListener('touchend', () => {
    isDragging = false;
});
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  

// const ctx = canvas.getContext('2d');

// function resizeCanvas() {
//   canvas.width = window.innerWidth;
//   canvas.height = window.innerHeight;

  // Optional: Redraw or re-render if needed
//   render();
// }

// Call it once to set the size initially
// resizeCanvas();

// Resize again whenever the window size changes
window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
  
    renderer.setSize(width, height);
    uniforms.resolution.value.set(width, height);
});
  

document.getElementById('updatePoly').addEventListener('click', () => {
    const userExpr = document.getElementById('polyInput').value;
    const fFunction = buildGLSLFunction(userExpr);
    const fullShader = baseShaderTemplate.replace('// REPLACE_F_FUNCTION', fFunction);
  
    material.fragmentShader = fullShader;
    material.needsUpdate = true;
});

const zoomSpeed = 0.025;
window.addEventListener('wheel', e => {
    uniforms.zoom.value *= e.deltaY > 0 ? (1.0 + zoomSpeed) :  (1.0 - zoomSpeed);
    uniforms.zoom.value = Math.max(0.1, Math.min(5.0, uniforms.zoom.value));
});

let touchZoomDistance = null;
canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (touchZoomDistance != null) {
            const scale = distance / touchZoomDistance; 
            uniforms.zoom.value /= scale;
            uniforms.zoom.value = Math.max(0.1, Math.min(5.0, uniforms.zoom.value));
        }

        touchZoomDistance = distance;
    }
}, {passive: false});

canvas.addEventListener('touchend', () => {
    touchZoomDistance = null;
});

// ==================== SLIDER + PAUSE FUNCTIONALITY ====================
const slider = document.getElementById('phaseSlider');
const ctx = slider.getContext('2d');
let draggingSlider = false;
let manualTheta = null;
let thetaWhenDragStarted = 0;
let timeWhenDragStarted = 0;
let thetaOffset = 0;
let isPaused = false;


function drawPhaseSlider(theta) {
    const w = slider.width = slider.clientWidth;
    const h = slider.height = slider.clientHeight;
    const r = w / 2;
    ctx.clearRect(0, 0, w, h);

    // Circle
    ctx.beginPath();
    ctx.arc(r, r, r - 10, 0, 2 * Math.PI); // circle centered at (r, r), radius = r - 5
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Phase indicator
    const angle = theta;
    const x = r + (r - 10) * Math.cos(angle);
    const y = r + (r - 10) * Math.sin(angle);
    
    // Border
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Fill
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = '#ccccff';
    ctx.fill();

    // Draw center pause/play icon
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = '#fff';

    if (isPaused) {
        // Draw play triangle
        ctx.beginPath();
        ctx.moveTo(-5, -7);
        ctx.lineTo(7, 0);
        ctx.lineTo(-5, 7);
        ctx.closePath();
        ctx.fill();
    } else {
        // Draw pause bars
        ctx.fillRect(-6, -7, 3, 14);
        ctx.fillRect(3, -7, 3, 14);
    }
    ctx.restore();

}

function getAngleFromCoords(x, y) {
    const rect = slider.getBoundingClientRect();
    const dx = x - rect.left - slider.clientWidth / 2;
    const dy = y - rect.top - slider.clientHeight / 2;
    return Math.atan2(dy, dx);
}

// Handle dragging
slider.addEventListener('mousedown', (e) => {
    const rect = slider.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 15) { // inside pause/play button radius
        console.log("Pause pressed");
        isPaused = !isPaused;
        console.log(isPaused);
        drawPhaseSlider(); // redraw icon
        return;
    }
    else {
        draggingSlider = true;
        timeWhenDragStarted = performance.now();
        thetaWhenDragStarted = uniforms.theta.value;
        manualTheta = getAngleFromCoords(e.clientX, e.clientY);
    }
    e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
    if (draggingSlider) {
        manualTheta = getAngleFromCoords(e.clientX, e.clientY);
    } 
});
window.addEventListener('mouseup', () => {
    draggingSlider = false;
    const elapsed = performance.now() - timeWhenDragStarted;
    thetaOffset = uniforms.theta.value - 0.0003 * (performance.now()); // track where to resume from
    manualTheta = null;
});
  
// Touch events for mobile
slider.addEventListener('touchstart', (e) => {
  draggingSlider = true;
  const touch = e.touches[0];
  manualTheta = getAngleFromCoords(touch.clientX, touch.clientY);
  e.preventDefault();
}, { passive: false });
slider.addEventListener('touchmove', (e) => {
  if (draggingSlider) {
    const touch = e.touches[0];
    manualTheta = getAngleFromCoords(touch.clientX, touch.clientY);
  }
}, { passive: false });
slider.addEventListener('touchend', () => draggingSlider = false);



function animate(time) {
    if (!isPaused && !draggingSlider) {
        uniforms.time.value = time * 0.001;
        uniforms.theta.value = (0.0003 * time + thetaOffset) % (2.0 * Math.PI);
    } else if (draggingSlider && manualTheta !== null) {
        uniforms.theta.value = manualTheta < 0 ? manualTheta + 2 * Math.PI : manualTheta;
    }

    drawPhaseSlider(uniforms.theta.value);

    // uniforms.theta.value = 0.0;
    uniforms.resolution = { value: new THREE.Vector2(window.innerWidth, window.innerHeight) };
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const xAxis = new THREE.Vector3(cosY, 0, -sinY);
    const yAxis = new THREE.Vector3(sinY * sinP, cosP, cosY * sinP);
    const zAxis = new THREE.Vector3(sinY * cosP, -sinP, cosP * cosY);
    uniforms.cameraMatrix.value.set(
        xAxis.x, yAxis.x, zAxis.x,
        xAxis.y, yAxis.y, zAxis.y,
        xAxis.z, yAxis.z, zAxis.z
    );
    // console.log(uniforms.cameraMatrix.value);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
  
animate();









