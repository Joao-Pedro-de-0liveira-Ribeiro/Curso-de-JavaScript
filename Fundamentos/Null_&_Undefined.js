const a = {nam: 'Teste'}
const b = a // B está recebendo o endereço para onde A aponta

// Atribuição Por Referencia
b.name = 'Opa' // É mudado o que está no endereço de B que é o mesmo de A
console.log(a) // A aparece com o mesmo valor que foi colocada en B, pois ambos igualaram seus endereços

// Outra forma de atribuição por referencia
let c = 3
let d = c
d++ // Incremento no valor em D
console.log(d) // Mostra 4, pois foi feita uma copia no valor, não implementando no valor de C
console.log(c) // Mostra 3

let valor // Não inicializadas
console.log(valor) // Gera um Undefined
console.log(valor2) // Gera um not defined, que significa não declarado

valor = null // Variavel sem valor, e endereço com local de endereço nela
console.log(valor) // Gera um null
// Use null para zerar uma variavel
console.log(valor.toString()) // Não le valor nulo, dando erro

const produto = {}
console.log(produto.preco)
console.log(produto)

produto.preco = 3.50
console.log(produto)

produto.preco = undefined // Evitar atribuir undefined
console.log(!!produto.preco)
// Para apagar use: delete produto.preco
console.log(produto)

produto.preco = null // Sem preço, OBTE pelo Null
console.log(!!produto.preco)
console.log(produto)