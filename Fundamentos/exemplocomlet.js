let numero = 1
{
    let numero = 2
    console.log('dentro = ', numero)
}
console.log('fora = ', numero) // Não há conflito pois let só irá imprimir seu valor de acordo com o escopo,
                               // em que e o let priorizar o bloco inteiro