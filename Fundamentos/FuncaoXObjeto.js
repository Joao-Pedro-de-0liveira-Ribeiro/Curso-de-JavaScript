console.log(typeof Object) // Resulta em Function
console.log(typeof new Object) // Resulta em Objeto

const Cliente = function(){}
console.log(typeof Cliente) // Resulta em Function
console.log(typeof new Cliente) // Resulta em Object

class Produto {} // ES2015
console.log(typeof Produto)
console.log(typeof new Produto)