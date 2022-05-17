// Armazenando Função em uma Variavel / Constante

const imprimirsoma = function (a, b) {
    console.log(a + b)
}

imprimirsoma(2, 3)

// Armazenando uma função Arrow em uma variavel
const soma = (a, b) => { // Reduz function para (=>)
    return a + b
}
console.log(soma(5, 5))

// Retorno Implícito
const subtracao = (a, b) => a - b // Retorna diretamente o resultado da operação
console.log(subtracao(20, 5))

const imprimir2 = a => console.log(a)
imprimir2('Bacanudo!!!')