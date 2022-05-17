// Hoisting: Issamento da declaração de uma variavel para cima 
//           para que o codigo não de erro

// Não declarando ela
console.log('a = ', a)
var a = 2
console.log('a = ', a)

// Como realmente ocorre
// var a
// console.log('a = ', a) // Gera Undefined
// a = 2
// console.log('a = ', a) // Devolve o valor 2

// Usando Let
console.log('b = ', b)
let b = 2 // Da erro ao utilizar let, pois o Hoisting não funciona nele
console.log('b = ', b)