// Função Sem Retorno
function imprimirSoma(a, b){
    console.log(a + b)
}

imprimirSoma(2, 3)
imprimirSoma(2) // Soma um numero com um Undefined, gerando um NaN
imprimirSoma(2, 3, 5, 6, 6, 9, 3, 1, 8, 10) // Soma apenas os primeiros 2
imprimirSoma() // Soma dois numeros Undefined, gerando um NaN

// Função com Retorno
function soma(a, b = 0) {
    return a + b
}
soma(2, 3) // Não funciona pois ele estará retornando o valor, e não o colocando para ser impresso
console.log(soma(2, 3)) // Para imprimir a função ela deve estar dentro de um console.log
console.log(soma(2)) // Retorna o proprio 2, por considerar b = 0
console.log(soma()) // NaN, pois não apresentou o primeiro valor