import * as THREE from 'three';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { OrbitControls  } from 'three/addons/controls/OrbitControls.js';

/* ANCHO DE TEXTURA PARA SIMULACIÓN */
const ANCHO = 64;
const PAJAROS = ANCHO * ANCHO;

/* HORNEAR ANIMACIÓN EN TEXTURA y CREAR GEOMETRÍA DESDE MODELO BASE */
const GeometriaPajaros = new THREE.BufferGeometry();
let texturaAnimacion, duracionAnimacion, mallaPajaros, materialShader, indicesPorPajaro;

function siguientePotenciaDe2( n ) {
    return Math.pow( 2, Math.ceil( Math.log( n ) / Math.log( 2 ) ) );
}

Math.lerp = function ( valor1, valor2, cantidad ) {
    cantidad = Math.max( Math.min( cantidad, 1 ), 0 );
    return valor1 + ( valor2 - valor1 ) * cantidad;
};

const modelos = [ 'models/cigueña.glb'];
const colores = [ 0xccFFFF, 0xffdeff ];
const tamanos = [ 0.2, 0.1 ];
const modeloSeleccionado = Math.floor( Math.random() * modelos.length );

new GLTFLoader().load( modelos[ modeloSeleccionado ], function ( gltf ) {
    const animaciones = gltf.animations;
    duracionAnimacion = Math.round( animaciones[ 0 ].duration * 60 );
    const geometriaPajaro = gltf.scene.children[ 0 ].geometry;
    const atributosMorfos = geometriaPajaro.morphAttributes.position;
    const tAlto = siguientePotenciaDe2( duracionAnimacion );
    const tAncho = siguientePotenciaDe2( geometriaPajaro.getAttribute( 'position' ).count );
    indicesPorPajaro = geometriaPajaro.index.count;
    const tDatos = new Float32Array( 4 * tAncho * tAlto );

    for ( let i = 0; i < tAncho; i ++ ) {
        for ( let j = 0; j < tAlto; j ++ ) {
            const desplazamiento = j * tAncho * 4;
            const morfoActual = Math.floor( j / duracionAnimacion * atributosMorfos.length );
            const siguienteMorfo = ( Math.floor( j / duracionAnimacion * atributosMorfos.length ) + 1 ) % atributosMorfos.length;
            const cantidadInterpolacion = j / duracionAnimacion * atributosMorfos.length % 1;

            if ( j < duracionAnimacion ) {
                let d0, d1;

                d0 = atributosMorfos[ morfoActual ].array[ i * 3 ];
                d1 = atributosMorfos[ siguienteMorfo ].array[ i * 3 ];

                if ( d0 !== undefined && d1 !== undefined ) tDatos[ desplazamiento + i * 4 ] = Math.lerp( d0, d1, cantidadInterpolacion );

                d0 = atributosMorfos[ morfoActual ].array[ i * 3 + 1 ];
                d1 = atributosMorfos[ siguienteMorfo ].array[ i * 3 + 1 ];

                if ( d0 !== undefined && d1 !== undefined ) tDatos[ desplazamiento + i * 4 + 1 ] = Math.lerp( d0, d1, cantidadInterpolacion );

                d0 = atributosMorfos[ morfoActual ].array[ i * 3 + 2 ];
                d1 = atributosMorfos[ siguienteMorfo ].array[ i * 3 + 2 ];

                if ( d0 !== undefined && d1 !== undefined ) tDatos[ desplazamiento + i * 4 + 2 ] = Math.lerp( d0, d1, cantidadInterpolacion );

                tDatos[ desplazamiento + i * 4 + 3 ] = 1;
            }
        }
    }

    texturaAnimacion = new THREE.DataTexture( tDatos, tAncho, tAlto, THREE.RGBAFormat, THREE.FloatType );
    texturaAnimacion.needsUpdate = true;

    const vertices = [], color = [], referencia = [], semillas = [], indices = [];
    const totalVertices = geometriaPajaro.getAttribute( 'position' ).count * 3 * PAJAROS;
    for ( let i = 0; i < totalVertices; i ++ ) {
        const indiceB = i % ( geometriaPajaro.getAttribute( 'position' ).count * 3 );
        vertices.push( geometriaPajaro.getAttribute( 'position' ).array[ indiceB ] );
        color.push( geometriaPajaro.getAttribute( 'color' ).array[ indiceB ] );
    }

    let r = Math.random();
    for ( let i = 0; i < geometriaPajaro.getAttribute( 'position' ).count * PAJAROS; i ++ ) {
        const indiceB = i % ( geometriaPajaro.getAttribute( 'position' ).count );
        const pajaro = Math.floor( i / geometriaPajaro.getAttribute( 'position' ).count );
        if ( indiceB == 0 ) r = Math.random();
        const j = ~ ~ pajaro;
        const x = ( j % ANCHO ) / ANCHO;
        const y = ~ ~ ( j / ANCHO ) / ANCHO;
        referencia.push( x, y, indiceB / tAncho, duracionAnimacion / tAlto );
        semillas.push( pajaro, r, Math.random(), Math.random() );
    }

    for ( let i = 0; i < geometriaPajaro.index.array.length * PAJAROS; i ++ ) {
        const desplazamiento = Math.floor( i / geometriaPajaro.index.array.length ) * ( geometriaPajaro.getAttribute( 'position' ).count );
        indices.push( geometriaPajaro.index.array[ i % geometriaPajaro.index.array.length ] + desplazamiento );
    }

    GeometriaPajaros.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( vertices ), 3 ) );
    GeometriaPajaros.setAttribute( 'birdColor', new THREE.BufferAttribute( new Float32Array( color ), 3 ) );
    GeometriaPajaros.setAttribute( 'color', new THREE.BufferAttribute( new Float32Array( color ), 3 ) );
    GeometriaPajaros.setAttribute( 'reference', new THREE.BufferAttribute( new Float32Array( referencia ), 4 ) );
    GeometriaPajaros.setAttribute( 'seeds', new THREE.BufferAttribute( new Float32Array( semillas ), 4 ) );

    GeometriaPajaros.setIndex( indices );

    iniciar();
} );

let contenedor, controles;
let camara, escena, renderizador;
let ratonX = 0, ratonY = 0;

let mitadAnchoVentana = window.innerWidth / 2;
let mitadAltoVentana = window.innerHeight / 2;

const LIMITES = 800, MITAD_LIMITES = LIMITES / 2;

let ultimo = performance.now();

let computacionGPU;
let variableVelocidad;
let variablePosicion;
let uniformesPosicion;
let uniformesVelocidad;

function iniciar() {
    contenedor = document.createElement( 'div' );
    document.body.appendChild( contenedor );

    // Cámara
    camara = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 5000 );
    camara.position.set(0, 200, 500);

    // Escena
    escena = new THREE.Scene();
    
    // Skybox
    crearSkybox();
    
    // Renderizador con fondo transparente
    renderizador = new THREE.WebGLRenderer( { 
        antialias: true,
        alpha: true
    } );
    renderizador.setPixelRatio( window.devicePixelRatio );
    renderizador.setSize( window.innerWidth, window.innerHeight );
    renderizador.shadowMap.enabled = true;
    renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
    renderizador.setAnimationLoop( animar );
    contenedor.appendChild( renderizador.domElement );

    // OrbitControls
    controles = new OrbitControls( camara, renderizador.domElement );
    controles.enableDamping = true;
    controles.dampingFactor = 0.05;
    controles.screenSpacePanning = false;
    controles.minDistance = 100;
    controles.maxDistance = 2000;
    controles.maxPolarAngle = Math.PI * 0.9;

    iniciarComputacionRenderizador();

    contenedor.style.touchAction = 'none';
    contenedor.addEventListener( 'pointermove', alMoverPuntero );

    window.addEventListener( 'resize', alRedimensionarVentana );

    const gui = new GUI();
    const controlesEfecto = {
        separacion: 20.0,
        alineacion: 20.0,
        cohesion: 20.0,
        libertad: 0.75,
        tamano: tamanos[ modeloSeleccionado ],
        cantidad: Math.floor( PAJAROS / 4 )
    };

    const cambiarValores = function () {
        // Actualiza los uniformes del shader de velocidad
        if (uniformesVelocidad) {
            uniformesVelocidad.distanciaSeparacion.value = controlesEfecto.separacion;
            uniformesVelocidad.distanciaAlineacion.value = controlesEfecto.alineacion;
            uniformesVelocidad.distanciaCohesion.value = controlesEfecto.cohesion;
            uniformesVelocidad.factorLibertad.value = controlesEfecto.libertad;
        }

        // Actualiza el tamaño de los pájaros
        if (materialShader) {
            materialShader.uniforms.tamano.value = controlesEfecto.tamano;
        }

        // Ajusta la cantidad de pájaros visibles
        GeometriaPajaros.setDrawRange(0, indicesPorPajaro * controlesEfecto.cantidad);
    };

    cambiarValores();

    gui.add( controlesEfecto, 'separacion', 0.0, 100.0, 1.0 ).onChange( cambiarValores );
    gui.add( controlesEfecto, 'alineacion', 0.0, 100, 0.001 ).onChange( cambiarValores );
    gui.add( controlesEfecto, 'cohesion', 0.0, 100, 0.025 ).onChange( cambiarValores );
    gui.add( controlesEfecto, 'tamano', 0, 1, 0.01 ).onChange( cambiarValores );
    gui.add( controlesEfecto, 'cantidad', 0, PAJAROS, 1 ).onChange( cambiarValores );
    gui.close();

    iniciarPajaros( controlesEfecto );
}

function crearSkybox() {
    const cargador = new EXRLoader();
    cargador.load('models/cielo10.exr', function(textura) {
        textura.mapping = THREE.EquirectangularReflectionMapping;
        
        // Crear skybox esfera
        const geometria = new THREE.SphereGeometry(2000, 64, 64);
        const material = new THREE.MeshBasicMaterial({
            map: textura,
            side: THREE.BackSide
        });
        
        const skybox = new THREE.Mesh(geometria, material);
        escena.add(skybox);
        
        // Establecer como fondo de escena y ambiente
        escena.background = textura;
        escena.environment = textura;
    });
}

function crearIluminacionMejorada() {
    // Luz ambiental para iluminación general
    const luzAmbiental = new THREE.AmbientLight( 0x404040, 0.5 );
    escena.add( luzAmbiental );

    // Luz direccional como sol
    const luzSolar = new THREE.DirectionalLight( 0xffffff, 1.0 );
    luzSolar.position.set( 100, 200, 100 );
    luzSolar.castShadow = true;
    luzSolar.shadow.mapSize.width = 2048;
    luzSolar.shadow.mapSize.height = 2048;
    luzSolar.shadow.camera.near = 0.5;
    luzSolar.shadow.camera.far = 500;
    luzSolar.shadow.camera.left = -200;
    luzSolar.shadow.camera.right = 200;
    luzSolar.shadow.camera.top = 200;
    luzSolar.shadow.camera.bottom = -200;
    escena.add( luzSolar );

    // Luz hemisférica para iluminación exterior más natural
    const luzHemisférica = new THREE.HemisphereLight( 0xffffbb, 0x080820, 0.6 );
    escena.add( luzHemisférica );

    // Añadir un poco de luz de relleno desde abajo
    const luzRelleno = new THREE.DirectionalLight( 0x7777ff, 0.3 );
    luzRelleno.position.set( 0, -100, 0 );
    escena.add( luzRelleno );
}

function iniciarComputacionRenderizador() {
    computacionGPU = new GPUComputationRenderer( ANCHO, ANCHO, renderizador );

    const dtPosicion = computacionGPU.createTexture();
    const dtVelocidad = computacionGPU.createTexture();
    rellenarTexturaPosicion( dtPosicion );
    rellenarTexturaVelocidad( dtVelocidad );

    variableVelocidad = computacionGPU.addVariable( 'textureVelocity', document.getElementById( 'fragmentShaderVelocity' ).textContent, dtVelocidad );
    variablePosicion = computacionGPU.addVariable( 'texturePosition', document.getElementById( 'fragmentShaderPosition' ).textContent, dtPosicion );

    computacionGPU.setVariableDependencies( variableVelocidad, [ variablePosicion, variableVelocidad ] );
    computacionGPU.setVariableDependencies( variablePosicion, [ variablePosicion, variableVelocidad ] );

    uniformesPosicion = variablePosicion.material.uniforms;
    uniformesVelocidad = variableVelocidad.material.uniforms;

    uniformesPosicion[ 'tiempo' ] = { value: 0.0 };
    uniformesPosicion[ 'delta' ] = { value: 0.0 };
    uniformesVelocidad[ 'tiempo' ] = { value: 1.0 };
    uniformesVelocidad[ 'delta' ] = { value: 0.0 };
    uniformesVelocidad[ 'testing' ] = { value: 1.0 };
    uniformesVelocidad[ 'distanciaSeparacion' ] = { value: 1.0 };
    uniformesVelocidad[ 'distanciaAlineacion' ] = { value: 1.0 };
    uniformesVelocidad[ 'distanciaCohesion' ] = { value: 1.0 };
    uniformesVelocidad[ 'factorLibertad' ] = { value: 1.0 };
    uniformesVelocidad[ 'depredador' ] = { value: new THREE.Vector3() };
    variableVelocidad.material.defines.BOUNDS = LIMITES.toFixed( 2 );

    variableVelocidad.wrapS = THREE.RepeatWrapping;
    variableVelocidad.wrapT = THREE.RepeatWrapping;
    variablePosicion.wrapS = THREE.RepeatWrapping;
    variablePosicion.wrapT = THREE.RepeatWrapping;

    const error = computacionGPU.init();

    if ( error !== null ) {
        console.error( error );
    }
}

function iniciarPajaros( controlesEfecto ) {
    const geometria = GeometriaPajaros;

    const m = new THREE.MeshStandardMaterial( {
        vertexColors: true,
        flatShading: true,
        roughness: 0.8,
        metalness: 0.2,
        emissive: 0x111111,
        emissiveIntensity: 0.2
    } );

    m.onBeforeCompile = ( shader ) => {
        shader.uniforms.texturePosition = { value: null };
        shader.uniforms.textureVelocity = { value: null };
        shader.uniforms.textureAnimation = { value: texturaAnimacion };
        shader.uniforms.tiempo = { value: 1.0 };
        shader.uniforms.tamano = { value: controlesEfecto.tamano };
        shader.uniforms.delta = { value: 0.0 };

        let token = '#define STANDARD';

        let insert = `
            attribute vec4 reference;
            attribute vec4 seeds;
            attribute vec3 birdColor;
            uniform sampler2D texturePosition;
            uniform sampler2D textureVelocity;
            uniform sampler2D textureAnimation;
            uniform float tamano;
            uniform float tiempo;
        `;

        shader.vertexShader = shader.vertexShader.replace( token, token + insert );

        token = '#include <begin_vertex>';

        insert = `
            vec4 tmpPos = texture2D( texturePosition, reference.xy );

            vec3 pos = tmpPos.xyz;
            vec3 velocidad = normalize(texture2D( textureVelocity, reference.xy ).xyz);
            vec3 aniPos = texture2D( textureAnimation, vec2( reference.z, mod( tiempo + ( seeds.x ) * ( ( 0.0004 + seeds.y / 10000.0) + normalize( velocidad ) / 20000.0 ), reference.w ) ) ).xyz;
            vec3 nuevaPosicion = position;

            nuevaPosicion = mat3( modelMatrix ) * ( nuevaPosicion + aniPos );
            nuevaPosicion *= tamano + seeds.y * tamano * 0.2;

            velocidad.z *= -1.;
            float xz = length( velocidad.xz );
            float xyz = 1.;
            float x = sqrt( 1. - velocidad.y * velocidad.y );

            float cosry = velocidad.x / xz;
            float sinry = velocidad.z / xz;

            float cosrz = x / xyz;
            float sinrz = velocidad.y / xyz;

            mat3 maty =  mat3( cosry, 0, -sinry, 0    , 1, 0     , sinry, 0, cosry );
            mat3 matz =  mat3( cosrz , sinrz, 0, -sinrz, cosrz, 0, 0     , 0    , 1 );

            nuevaPosicion =  maty * matz * nuevaPosicion;
            nuevaPosicion += pos;

            vec3 transformed = vec3( nuevaPosicion );
        `;

        shader.vertexShader = shader.vertexShader.replace( token, insert );

        materialShader = shader;
    };

    mallaPajaros = new THREE.Mesh( geometria, m );
    mallaPajaros.rotation.y = Math.PI / 2;
    mallaPajaros.castShadow = true;
    mallaPajaros.receiveShadow = true;
    escena.add( mallaPajaros );
}

function rellenarTexturaPosicion( textura ) {
    const elArray = textura.image.data;

    for ( let k = 0, kl = elArray.length; k < kl; k += 4 ) {
        const x = Math.random() * LIMITES - MITAD_LIMITES;
        const y = Math.random() * LIMITES - MITAD_LIMITES;
        const z = Math.random() * LIMITES - MITAD_LIMITES;

        elArray[ k + 0 ] = x;
        elArray[ k + 1 ] = y;
        elArray[ k + 2 ] = z;
        elArray[ k + 3 ] = 1;
    }
}

function rellenarTexturaVelocidad( textura ) {
    const elArray = textura.image.data;

    for ( let k = 0, kl = elArray.length; k < kl; k += 4 ) {
        const x = Math.random() - 0.5;
        const y = Math.random() - 0.5;
        const z = Math.random() - 0.5;

        elArray[ k + 0 ] = x * 10;
        elArray[ k + 1 ] = y * 10;
        elArray[ k + 2 ] = z * 10;
        elArray[ k + 3 ] = 1;
    }
}

function alRedimensionarVentana() {
    mitadAnchoVentana = window.innerWidth / 2;
    mitadAltoVentana = window.innerHeight / 2;

    camara.aspect = window.innerWidth / window.innerHeight;
    camara.updateProjectionMatrix();

    renderizador.setSize( window.innerWidth, window.innerHeight );
}

function alMoverPuntero( event ) {
    if ( event.isPrimary === false ) return;

    ratonX = event.clientX - mitadAnchoVentana;
    ratonY = event.clientY - mitadAltoVentana;
}

function animar() {
    controles.update();
    renderizar();
}

function renderizar() {
    const ahora = performance.now();
    let delta = ( ahora - ultimo ) / 1000;

    if ( delta > 1 ) delta = 1; // límite de seguridad para deltas grandes
    ultimo = ahora;

    uniformesPosicion[ 'tiempo' ].value = ahora;
    uniformesPosicion[ 'delta' ].value = delta;
    uniformesVelocidad[ 'tiempo' ].value = ahora;
    uniformesVelocidad[ 'delta' ].value = delta;
    if ( materialShader ) materialShader.uniforms[ 'tiempo' ].value = ahora / 1000;
    if ( materialShader ) materialShader.uniforms[ 'delta' ].value = delta;

    uniformesVelocidad[ 'depredador' ].value.set( 0.5 * ratonX / mitadAnchoVentana, - 0.5 * ratonY / mitadAltoVentana, 0 );

    ratonX = 10000;
    ratonY = 10000;

    computacionGPU.compute();

    if ( materialShader ) materialShader.uniforms[ 'texturePosition' ].value = computacionGPU.getCurrentRenderTarget( variablePosicion ).texture;
    if ( materialShader ) materialShader.uniforms[ 'textureVelocity' ].value = computacionGPU.getCurrentRenderTarget( variableVelocidad ).texture;

    renderizador.render( escena, camara );
}

window.onload = () => {
    setTimeout(() => {
        document.getElementById('loadingScreen').style.display = 'none'; // Ocultar pantalla de carga
    }, 3000); // 3000 ms (3 segundos)
};




