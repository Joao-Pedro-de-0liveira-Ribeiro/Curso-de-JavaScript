const imprimirResultado = function(nota) {
    if (nota >= 7) {
        console.log('Aprovado!')
    } else {
        console.log('Reprovado, SEU BURRO!!!')
    }
}

imprimirResultado(10)
imprimirResultado(4)
imprimirResultado('opoha') // Evite testando se ha um valor inteiro passando